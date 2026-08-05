package utils

import (
	"context"
	"math/big"
	"os"
	"time"

	"sign-extension/tools/pkg/contracts/sign"
	"sign-extension/tools/pkg/fccutils"
	"sign-extension/tools/pkg/support"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/pkg/errors"
)

// DefaultFee is the default fee paid with each instruction.
// Override via FEE_WEI env var.
var DefaultFee = big.NewInt(1_000_000_000_000)

func init() {
	if feeStr := os.Getenv("FEE_WEI"); feeStr != "" {
		if fee, ok := new(big.Int).SetString(feeStr, 10); ok {
			DefaultFee = fee
		}
	}
}

// DeployInstructionSender deploys the sign-extension InstructionSender contract
// and returns its address.
func DeployInstructionSender(s *support.Support) (common.Address, *sign.InstructionSender, error) {
	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Address{}, nil, errors.Errorf("failed to create transactor: %s", err)
	}

	// Both registry args are the FlareTeeManager diamond proxy: the diamond
	// routes ExtensionManager and MachineManager calls to the right facets.
	address, tx, contract, err := sign.DeployInstructionSender(
		opts, s.ChainClient, s.Addresses.FlareTeeManager, s.Addresses.FlareTeeManager,
	)
	if err != nil {
		return common.Address{}, nil, errors.Errorf("failed to deploy contract: %s", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	receipt, err := bind.WaitMined(ctx, s.ChainClient, tx)
	if err != nil {
		return common.Address{}, nil, errors.Errorf("deployment tx not mined within 2 minutes (tx: %s): %s", tx.Hash().Hex(), err)
	}

	if receipt.Status != types.ReceiptStatusSuccessful {
		return common.Address{}, nil, errors.New("contract deployment failed")
	}

	return address, contract, nil
}

// SetExtensionId calls setExtensionId on the InstructionSender contract.
func SetExtensionId(s *support.Support, instructionSenderAddress common.Address) error {
	sender, err := sign.NewInstructionSender(instructionSenderAddress, s.ChainClient)
	if err != nil {
		return errors.Errorf("failed to bind contract: %s", err)
	}

	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return errors.Errorf("failed to create transactor: %s", err)
	}

	tx, err := sender.SetExtensionId(opts)
	if err != nil {
		reason := fccutils.DecodeRevertReason(err)
		if reason == "" {
			parsed, _ := sign.InstructionSenderMetaData.GetAbi()
			if parsed != nil {
				callData, packErr := parsed.Pack("setExtensionId")
				if packErr == nil {
					from := crypto.PubkeyToAddress(s.Prv.PublicKey)
					reason = fccutils.SimulateAndDecodeRevert(
						s.ChainClient, from, instructionSenderAddress, nil, callData,
					)
				}
			}
		}
		if reason != "" {
			return errors.Errorf("failed to call setExtensionId: %s (revert reason: %s)", err, reason)
		}
		return errors.Errorf("failed to call setExtensionId: %s", err)
	}

	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return errors.Errorf("failed waiting for transaction: %s", err)
	}

	if receipt.Status != types.ReceiptStatusSuccessful {
		parsed, _ := sign.InstructionSenderMetaData.GetAbi()
		if parsed != nil {
			callData, packErr := parsed.Pack("setExtensionId")
			if packErr == nil {
				from := crypto.PubkeyToAddress(s.Prv.PublicKey)
				reason := fccutils.SimulateAndDecodeRevert(
					s.ChainClient, from, instructionSenderAddress, nil, callData,
				)
				if reason != "" {
					return errors.Errorf("setExtensionId transaction failed (revert reason: %s)", reason)
				}
			}
		}
		return errors.New("setExtensionId transaction failed")
	}

	return nil
}

// sendInstruction submits one instruction-sending call on the InstructionSender
// and returns the registry-assigned instruction id together with the
// transaction hash.
//
// Every Kerb send follows the same shape: pay the fee, transact, decode the
// revert reason when the node hides it, wait for the receipt and read the
// instruction id off the TeeInstructionsSent event. Only the contract method
// and its arguments differ, so they are the parameters.
func sendInstruction(
	s *support.Support,
	instructionSenderAddress common.Address,
	methodName string,
	methodArgs []interface{},
	transact func(*bind.TransactOpts, *sign.InstructionSender) (*types.Transaction, error),
) (common.Hash, common.Hash, error) {
	sender, err := sign.NewInstructionSender(instructionSenderAddress, s.ChainClient)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to bind contract: %s", err)
	}

	opts, err := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to create transactor: %s", err)
	}
	opts.Value = DefaultFee

	tx, err := transact(opts, sender)
	if err != nil {
		reason := fccutils.DecodeRevertReason(err)
		if reason == "" {
			parsed, _ := sign.InstructionSenderMetaData.GetAbi()
			if parsed != nil {
				callData, packErr := parsed.Pack(methodName, methodArgs...)
				if packErr == nil {
					from := crypto.PubkeyToAddress(s.Prv.PublicKey)
					reason = fccutils.SimulateAndDecodeRevert(
						s.ChainClient, from, instructionSenderAddress, DefaultFee, callData,
					)
				}
			}
		}
		if reason != "" {
			return common.Hash{}, common.Hash{}, errors.Errorf("failed to send %s: %s (revert reason: %s)", methodName, err, reason)
		}
		return common.Hash{}, common.Hash{}, errors.Errorf("failed to send %s: %s", methodName, err)
	}

	receipt, err := bind.WaitMined(context.Background(), s.ChainClient, tx)
	if err != nil {
		return common.Hash{}, common.Hash{}, errors.Errorf("failed waiting for %s transaction: %s", methodName, err)
	}
	if receipt.Status != types.ReceiptStatusSuccessful {
		return common.Hash{}, common.Hash{}, errors.Errorf("%s transaction failed with status: %d", methodName, receipt.Status)
	}
	if len(receipt.Logs) == 0 {
		return common.Hash{}, common.Hash{}, errors.Errorf("no logs found in %s receipt", methodName)
	}

	// The receipt carries logs from every contract the call touched: Kerb's
	// own events (MandateCreated, MandateCancelled) sit next to the registry's
	// TeeInstructionsSent, and their order depends on the method. Scan for the
	// one that parses instead of assuming it comes first.
	for _, receiptLog := range receipt.Logs {
		instructionSent, parseErr := s.TeeVerification.ParseTeeInstructionsSent(*receiptLog)
		if parseErr == nil {
			return instructionSent.InstructionId, receipt.TxHash, nil
		}
	}
	return common.Hash{}, common.Hash{}, errors.Errorf(
		"no TeeInstructionsSent event among the %d logs of the %s receipt", len(receipt.Logs), methodName,
	)
}

// SendInitSeed delivers the encrypted enclave master seed.
// Returns (instructionId, txHash).
func SendInitSeed(s *support.Support, instructionSenderAddress common.Address, encryptedSeed []byte) (common.Hash, common.Hash, error) {
	return sendInstruction(s, instructionSenderAddress, "initSeed", []interface{}{encryptedSeed},
		func(opts *bind.TransactOpts, sender *sign.InstructionSender) (*types.Transaction, error) {
			return sender.InitSeed(opts, encryptedSeed)
		})
}

// SendCreateMandate registers an encrypted mandate and asks the enclave to
// derive its XRPL deposit address.
// Returns (instructionId, txHash).
func SendCreateMandate(s *support.Support, instructionSenderAddress common.Address, encryptedMandate []byte) (common.Hash, common.Hash, error) {
	return sendInstruction(s, instructionSenderAddress, "createMandate", []interface{}{encryptedMandate},
		func(opts *bind.TransactOpts, sender *sign.InstructionSender) (*types.Transaction, error) {
			return sender.CreateMandate(opts, encryptedMandate)
		})
}

// SendCancelMandate cancels a mandate on-chain and notifies the enclave.
// Returns (instructionId, txHash).
func SendCancelMandate(s *support.Support, instructionSenderAddress common.Address, mandateId *big.Int) (common.Hash, common.Hash, error) {
	return sendInstruction(s, instructionSenderAddress, "cancelMandate", []interface{}{mandateId},
		func(opts *bind.TransactOpts, sender *sign.InstructionSender) (*types.Transaction, error) {
			return sender.CancelMandate(opts, mandateId)
		})
}
