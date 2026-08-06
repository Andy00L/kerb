// Package main sends a REPORT instruction for one mandate and prints the
// instruction id, leaving the stored result for the keeper to relay through
// applyExecutionReport (fetching it here would consume nothing, but the
// keeper is the intended reader either way).
package main

import (
	"flag"
	"math/big"
	"os"

	"sign-extension/tools/pkg/configs"
	"sign-extension/tools/pkg/fccutils"
	"sign-extension/tools/pkg/support"
	instrutils "sign-extension/tools/pkg/utils"

	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/pkg/errors"
)

func main() {
	af := flag.String("a", configs.AddressesFile, "file with deployed addresses")
	cf := flag.String("c", configs.ChainNodeURL, "chain node url")
	instructionSenderF := flag.String("instructionSender", os.Getenv("INSTRUCTION_SENDER"), "InstructionSender contract address")
	mandateIdF := flag.Int64("mandate", 0, "mandate id to report on")
	flag.Parse()

	if *instructionSenderF == "" || *mandateIdF <= 0 {
		logger.Fatal("usage: request-report -instructionSender 0x... -mandate <id>")
	}

	reportSupport, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	instructionID, txHash, err := instrutils.SendRequestReport(
		reportSupport, common.HexToAddress(*instructionSenderF), big.NewInt(*mandateIdF),
	)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("requestReport: %s", err))
	}
	logger.Infof("requestReport sent for mandate %d (tx %s)", *mandateIdF, txHash.Hex())
	logger.Infof("relay with: keeper.js report %s", instructionID.Hex())
}
