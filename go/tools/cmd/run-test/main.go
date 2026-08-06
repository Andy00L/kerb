// Package main runs the Kerb end-to-end test:
//   1. setExtensionId on the deployed InstructionSender (idempotent)
//   2. fetch the TEE public key from the extension proxy
//   3. ECIES-encrypt a fresh 32 byte master seed, send initSeed, poll the result
//   4. ECIES-encrypt a stop-loss mandate, send createMandate, poll the result
//   5. ABI-decode (address, uint256, string) and check the enclave returned the
//      mandate back with a derived XRPL deposit address
//   6. cancel the mandate and confirm the enclave accepted the cancellation
package main

import (
	"crypto/rand"
	"encoding/json"
	"flag"
	"math/big"
	"os"
	"strings"
	"time"

	"sign-extension/tools/pkg/configs"
	"sign-extension/tools/pkg/fccutils"
	"sign-extension/tools/pkg/support"
	instrutils "sign-extension/tools/pkg/utils"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto/ecies"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/flare-foundation/tee-node/pkg/types"
	"github.com/pkg/errors"
)

// masterSeedBytes must match MASTER_SEED_BYTES in the extension.
const masterSeedBytes = 32

// XRP/USD block-latency feed on Coston2.
// sourceRef: https://dev.flare.network/ftso/feeds.md
const xrpUsdFeedID = "0x015852502f55534400000000000000000000000000"

// demoPayoutAddress is a valid XRPL classic address used only as the mandate's
// payout target in this test. Nothing is ever sent to it here.
const demoPayoutAddress = "rNMovRR3WPbFLVaSbETCCR71XsqyxhJ9P6"

// resultPollDelay gives the data providers time to relay the instruction and
// the enclave time to answer before the first poll.
const resultPollDelay = 5 * time.Second

func main() {
	af := flag.String("a", configs.AddressesFile, "file with deployed addresses")
	cf := flag.String("c", configs.ChainNodeURL, "chain node url")
	pf := flag.String("p", configs.ExtensionProxyURL, "extension proxy url")
	instructionSenderF := flag.String("instructionSender", os.Getenv("INSTRUCTION_SENDER"), "InstructionSender contract address")
	payoutF := flag.String("payout", demoPayoutAddress, "XRPL payout address for the mandate")
	priceF := flag.String("triggerPrice", "0.10", "trigger price (decimal string)")
	totalF := flag.String("total", "250", "total size in XRP")
	sliceF := flag.String("slice", "50", "slice size in XRP")
	jitterF := flag.Int("jitter", 20, "jitter percent")
	expiryHoursF := flag.Int("expiryHours", 1, "mandate lifetime in hours")
	keepF := flag.Bool("keep", false, "keep the mandate alive (skip the cancel step)")
	flag.Parse()

	if *instructionSenderF == "" {
		logger.Fatal("--instructionSender flag is required (or set INSTRUCTION_SENDER in .env)")
	}

	instructionSenderAddress := common.HexToAddress(*instructionSenderF)

	testSupport, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	// --- Step 1: setExtensionId ---
	logger.Infof("Step 1: Setting extension ID on InstructionSender...")
	if err := instrutils.SetExtensionId(testSupport, instructionSenderAddress); err != nil {
		if strings.Contains(err.Error(), "already set") {
			logger.Infof("  Extension ID already set on contract, continuing")
		} else {
			fccutils.FatalWithCause(errors.Errorf(
				"setExtensionId failed. Is the extension registered? Check pre-build.sh completed. Error: %s", err))
		}
	} else {
		logger.Infof("  Extension ID set.")
	}

	// --- Step 2: TEE public key ---
	logger.Infof("Step 2: Fetching TEE public key from extension proxy...")
	teeInfo, err := fccutils.TeeInfo(*pf)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("fetch TEE info: %s", err))
	}

	ecdsaPub, err := types.ParsePubKey(teeInfo.MachineData.PublicKey)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("parse TEE public key: %s", err))
	}

	eciesPub := &ecies.PublicKey{
		X:      ecdsaPub.X,
		Y:      ecdsaPub.Y,
		Curve:  ecies.DefaultCurve,
		Params: ecies.ECIES_AES128_SHA256,
	}

	// --- Step 3: initSeed ---
	logger.Infof("Step 3: Installing the enclave master seed...")
	masterSeed := make([]byte, masterSeedBytes)
	if _, err := rand.Read(masterSeed); err != nil {
		fccutils.FatalWithCause(errors.Errorf("generate master seed: %s", err))
	}
	// The seed itself is never logged: it derives every mandate's XRPL key.
	encryptedSeed, err := ecies.Encrypt(rand.Reader, eciesPub, masterSeed, nil, nil)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("ECIES encrypt seed: %s", err))
	}

	seedInstructionID, _, err := instrutils.SendInitSeed(testSupport, instructionSenderAddress, encryptedSeed)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("initSeed: %s", err))
	}
	logger.Infof("  initSeed instruction ID: %s", seedInstructionID.Hex())

	time.Sleep(resultPollDelay)
	seedResponse, err := fccutils.ActionResult(*pf, seedInstructionID)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("poll initSeed: %s", err))
	}
	if seedResponse.Result.Status != 1 {
		fccutils.FatalWithCause(errors.Errorf(
			"initSeed did not succeed (status=%d): %s", seedResponse.Result.Status, seedResponse.Result.Log))
	}
	logger.Infof("  Master seed installed.")

	// --- Step 4: createMandate ---
	logger.Infof("Step 4: Creating an encrypted stop-loss mandate...")
	mandateJSON, err := buildMandateJSON(*payoutF, *priceF, *totalF, *sliceF, *jitterF, *expiryHoursF)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("build mandate: %s", err))
	}
	encryptedMandate, err := ecies.Encrypt(rand.Reader, eciesPub, mandateJSON, nil, nil)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("ECIES encrypt mandate: %s", err))
	}
	logger.Infof("  Encrypted mandate: %d bytes", len(encryptedMandate))

	mandateInstructionID, _, err := instrutils.SendCreateMandate(testSupport, instructionSenderAddress, encryptedMandate)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("createMandate: %s", err))
	}
	logger.Infof("  createMandate instruction ID: %s", mandateInstructionID.Hex())

	// The proxy hands a stored result out once: whoever fetches it consumes it.
	// In -keep mode the keeper must be that reader, so it can relay the signed
	// provisioning result on-chain through applyProvision. Reading it here for
	// display would strand the mandate at CREATED forever.
	if *keepF {
		logger.Infof("Step 5 and 6: Skipped (-keep). Relay the result with:")
		logger.Infof("  keeper.js provision %s", mandateInstructionID.Hex())
		return
	}

	time.Sleep(resultPollDelay)
	mandateResponse, err := fccutils.ActionResult(*pf, mandateInstructionID)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("poll createMandate: %s", err))
	}
	if mandateResponse.Result.Status != 1 {
		fccutils.FatalWithCause(errors.Errorf(
			"createMandate did not succeed (status=%d): %s", mandateResponse.Result.Status, mandateResponse.Result.Log))
	}

	// --- Step 5: check the provisioning result ---
	logger.Infof("Step 5: Decoding the provisioning result...")
	contractAddress, mandateID, depositAddress, err := decodeProvisionResult(mandateResponse.Result.Data)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("decode provision result: %s", err))
	}

	if contractAddress != instructionSenderAddress {
		fccutils.FatalWithCause(errors.Errorf(
			"FAIL: result names contract %s, expected %s", contractAddress.Hex(), instructionSenderAddress.Hex()))
	}
	if !strings.HasPrefix(depositAddress, "r") || len(depositAddress) < 25 {
		fccutils.FatalWithCause(errors.Errorf("FAIL: %q is not an XRPL classic address", depositAddress))
	}
	logger.Infof("  Mandate %s deposit address: %s", mandateID.String(), depositAddress)

	// --- Step 6: cancelMandate ---
	logger.Infof("Step 6: Cancelling the mandate...")
	cancelInstructionID, _, err := instrutils.SendCancelMandate(testSupport, instructionSenderAddress, mandateID)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("cancelMandate: %s", err))
	}

	time.Sleep(resultPollDelay)
	cancelResponse, err := fccutils.ActionResult(*pf, cancelInstructionID)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("poll cancelMandate: %s", err))
	}
	if cancelResponse.Result.Status != 1 {
		fccutils.FatalWithCause(errors.Errorf(
			"cancelMandate did not succeed (status=%d): %s", cancelResponse.Result.Status, cancelResponse.Result.Log))
	}
	logger.Infof("  Mandate cancelled.")

	logger.Infof("All tests passed.")
}

// buildMandateJSON produces a schema-valid stop-loss mandate matching the
// schema the extension enforces. Parameters come from the CLI flags so the
// same command drives both the automated test and a live demo mandate.
func buildMandateJSON(payoutAddress, triggerPrice, total, slice string, jitterPercent, expiryHours int) ([]byte, error) {
	mandate := map[string]interface{}{
		"v":    1,
		"pair": "XRP/USD",
		"side": "sell",
		"kind": "stop",
		"trigger": map[string]interface{}{
			"feedId": xrpUsdFeedID,
			"op":     "lte",
			"price":  triggerPrice,
		},
		"size": map[string]interface{}{
			"total":     total,
			"slice":     slice,
			"jitterPct": jitterPercent,
		},
		"bound":  map[string]interface{}{"maxSlippagePct": 1},
		"expiry": time.Now().Add(time.Duration(expiryHours) * time.Hour).Unix(),
		"payout": map[string]interface{}{"xrplAddress": payoutAddress},
	}
	return json.Marshal(mandate)
}

// decodeProvisionResult decodes the (address, uint256, string) tuple the
// enclave returns for CREATE_MANDATE, which is the same shape the contract's
// applyProvision function decodes.
func decodeProvisionResult(data []byte) (common.Address, *big.Int, string, error) {
	addressType, err := abi.NewType("address", "", nil)
	if err != nil {
		return common.Address{}, nil, "", err
	}
	uintType, err := abi.NewType("uint256", "", nil)
	if err != nil {
		return common.Address{}, nil, "", err
	}
	stringType, err := abi.NewType("string", "", nil)
	if err != nil {
		return common.Address{}, nil, "", err
	}

	arguments := abi.Arguments{{Type: addressType}, {Type: uintType}, {Type: stringType}}
	values, err := arguments.Unpack(data)
	if err != nil {
		return common.Address{}, nil, "", err
	}
	if len(values) != 3 {
		return common.Address{}, nil, "", errors.Errorf("expected 3 result fields, got %d", len(values))
	}

	contractAddress, ok := values[0].(common.Address)
	if !ok {
		return common.Address{}, nil, "", errors.New("first field is not an address")
	}
	mandateID, ok := values[1].(*big.Int)
	if !ok {
		return common.Address{}, nil, "", errors.New("second field is not a uint256")
	}
	depositAddress, ok := values[2].(string)
	if !ok {
		return common.Address{}, nil, "", errors.New("third field is not a string")
	}
	return contractAddress, mandateID, depositAddress, nil
}
