// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

// Minimal local copy of the FDC XRPPayment attestation type, kept here for the
// same reason as the TEE registry interfaces: flare-smart-contracts-v2 is not
// published as a package yet.
//
// Attestation type id 0x08, supported sources XRP and testXRP. The deployed
// Coston2 FdcVerification exposes verifyXRPPayment even though the published
// IFdcVerification reference does not list it yet.
// sourceRef: https://dev.flare.network/fdc/attestation-types/xrp-payment
interface IXRPPayment {
    struct RequestBody {
        bytes32 transactionId;
        address proofOwner;
    }

    struct ResponseBody {
        uint64 blockNumber;
        uint64 blockTimestamp;
        string sourceAddress;
        bytes32 sourceAddressHash;
        bytes32 receivingAddressHash;
        bytes32 intendedReceivingAddressHash;
        int256 spentAmount;
        int256 intendedSpentAmount;
        int256 receivedAmount;
        int256 intendedReceivedAmount;
        bool hasMemoData;
        bytes firstMemoData;
        bool hasDestinationTag;
        uint256 destinationTag;
        uint8 status;
    }

    struct Request {
        bytes32 attestationType;
        bytes32 sourceId;
        bytes32 messageIntegrityCode;
        RequestBody requestBody;
    }

    struct Response {
        bytes32 attestationType;
        bytes32 sourceId;
        uint64 votingRound;
        uint64 lowestUsedTimestamp;
        RequestBody requestBody;
        ResponseBody responseBody;
    }

    struct Proof {
        bytes32[] merkleProof;
        Response data;
    }
}
