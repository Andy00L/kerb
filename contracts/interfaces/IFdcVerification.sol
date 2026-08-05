// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import { IXRPPayment } from "./IXRPPayment.sol";

// Minimal local copy of the FDC verification entry point.
// On Coston2 the contract lives at 0x906507E0B64bcD494Db73bd0459d1C667e14B933,
// resolvable through FlareContractRegistry under the name "FdcVerification".
// sourceRef: https://dev.flare.network/fdc/reference
interface IFdcVerification {
    /// @notice Checks an XRPPayment attestation against the finalised Merkle
    ///         root for its voting round.
    /// @param _proof Merkle proof plus the attested response.
    /// @return True when the proof is valid for a finalised round.
    function verifyXRPPayment(IXRPPayment.Proof calldata _proof) external view returns (bool);
}
