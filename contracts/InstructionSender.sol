// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TODO: Replace local interfaces with imports from flare-smart-contracts-v2 once published as a package.
import { ITeeExtensionRegistry } from "./interfaces/ITeeExtensionRegistry.sol";
import { ITeeMachineRegistry } from "./interfaces/ITeeMachineRegistry.sol";
import { IFdcVerification } from "./interfaces/IFdcVerification.sol";
import { IXRPPayment } from "./interfaces/IXRPPayment.sol";

/// @title InstructionSender (Kerb)
/// @author Kerb
/// @notice On-chain entry point and mandate registry for Kerb, the confidential
///         order automation extension for the XRPL DEX. Users submit an
///         ECIES-encrypted mandate; the enclave decrypts it, derives a dedicated
///         XRPL deposit address, watches the FTSOv2 price feed and executes on
///         XRPL when the trigger is met.
///
///         The contract keeps the file name and contract name of the scaffold's
///         InstructionSender because the Go deploy tooling resolves both by name
///         (scripts/generate-bindings.sh, go/tools/cmd/deploy-contract).
///
/// DO NOT MODIFY: the constructor signature, setExtensionId(), _getExtensionId()
contract InstructionSender {
    /// @notice Operation type for every Kerb action.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_TYPE_KERB = bytes32("KERB");

    /// @notice Delivers the encrypted enclave master seed. Sent once per TEE.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_INIT_SEED = bytes32("INIT_SEED");

    /// @notice Registers an encrypted mandate and asks for a deposit address.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_CREATE_MANDATE = bytes32("CREATE_MANDATE");

    /// @notice Tells the enclave to stop working a mandate and settle it.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_CANCEL_MANDATE = bytes32("CANCEL_MANDATE");

    /// @notice Asks the enclave for the current execution state of a mandate.
    ///         Execution is autonomous, driven by the price feed rather than by
    ///         an instruction, so this is how a signed report is obtained for
    ///         applyExecutionReport to ingest.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_REPORT = bytes32("REPORT");

    /// @notice Domain separator the TEE node prepends when signing an ActionResult.
    ///         The node signs keccak256(abi.encode(prefix, chainId, resultHash)),
    ///         where resultHash covers only Data, ID, SubmissionTag and Status.
    ///         Every other ActionResult field is unsigned and is never trusted here.
    ///         sourceRef: tee-node pkg/types/actions.go (ActionResult.Hash) and
    ///         internal/router/utils.go (csigning.NewPayload).
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 private constant TEE_ACTION_RESULT_PREFIX = bytes32("TEE_ACTION_RESULT");

    /// @notice Lifecycle of a mandate.
    /// PROVISIONED is set when the enclave returns the derived deposit address.
    /// FUNDED is set by the FDC deposit proof, SETTLED by the FDC settlement proof.
    enum MandateStatus {
        NONE,
        CREATED,
        PROVISIONED,
        FUNDED,
        EXECUTING,
        FILLED,
        EXPIRED,
        CANCELLED,
        SETTLED
    }

    /// @notice One confidential order. Only the hash of the encrypted mandate is
    ///         stored: the ciphertext itself lives in calldata and in the
    ///         instruction relayed to the TEE, never in contract storage.
    struct Mandate {
        address owner;
        bytes32 blobHash;
        string depositAddress;
        MandateStatus status;
        uint64 createdAt;
        uint64 filledDrops;
        uint64 lastReportAt;
    }

    /// @notice Reference to the TEE extension registry contract.
    ITeeExtensionRegistry public immutable TEE_EXTENSION_REGISTRY;
    /// @notice Reference to the TEE machine registry contract.
    ITeeMachineRegistry public immutable TEE_MACHINE_REGISTRY;

    /// @notice First public extension ID. The registry reserves IDs below this
    /// for system/reserved extensions; public extensions are assigned from here up.
    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000; // 65536

    uint256 private _extensionId;

    /// @notice Deployer of this contract. Authorised to declare the TEE identity.
    address public immutable OWNER;

    /// @notice TEE identity whose signature is accepted on result ingestion.
    ///         Read from the proxy /info endpoint after registration and declared
    ///         once by the owner. Results are refused while this is unset.
    address public teeAddress;

    /// @notice All mandates, indexed by mandate id.
    Mandate[] private _mandates;

    /// @notice FDC verification contract used to check XRPL payment proofs.
    ///         Set by the owner rather than the constructor, whose ABI the
    ///         deploy tooling encodes and must not change.
    IFdcVerification public fdcVerification;

    /// @notice XRPL transactions already consumed as a proof, so the same
    ///         deposit or settlement cannot be replayed against a mandate.
    mapping(bytes32 => bool) public provenTransactions;

    event MandateCreated(uint256 indexed mandateId, address indexed owner, bytes32 blobHash);
    event MandateProvisioned(uint256 indexed mandateId, string depositAddress);
    event MandateExecuted(
        uint256 indexed mandateId,
        MandateStatus status,
        uint64 filledDrops,
        bytes32 xrplTxHash
    );
    event MandateCancelled(uint256 indexed mandateId, address indexed owner);
    event MandateFunded(uint256 indexed mandateId, uint256 receivedDrops, bytes32 xrplTxId);
    event MandateSettled(uint256 indexed mandateId, uint256 paidDrops, bytes32 xrplTxId);
    event TeeAddressSet(address indexed teeAddress);
    event FdcVerificationSet(address indexed fdcVerification);

    /// @notice Initializes the contract with registry addresses.
    /// @param _teeExtensionRegistry Address of the TEE extension registry.
    /// @param _teeMachineRegistry Address of the TEE machine registry.
    constructor(
        ITeeExtensionRegistry _teeExtensionRegistry,
        ITeeMachineRegistry _teeMachineRegistry
    ) {
        require(address(_teeExtensionRegistry) != address(0), "TeeExtensionRegistry cannot be zero address");
        require(address(_teeMachineRegistry) != address(0), "TeeMachineRegistry cannot be zero address");
        require(address(_teeExtensionRegistry).code.length > 0, "TeeExtensionRegistry has no code");
        require(address(_teeMachineRegistry).code.length > 0, "TeeMachineRegistry has no code");
        TEE_EXTENSION_REGISTRY = _teeExtensionRegistry;
        TEE_MACHINE_REGISTRY = _teeMachineRegistry;
        // Recorded here so result ingestion has an authority to trust. The
        // constructor ABI is unchanged, which is what the deploy tooling encodes.
        OWNER = msg.sender;
    }

    /// @notice Finds and sets this contract's extension id. Can only be set once.
    /// DO NOT MODIFY this function.
    function setExtensionId() external {
        require(_extensionId == 0, "Extension ID already set.");

        uint256 c = TEE_EXTENSION_REGISTRY.nextPublicExtensionId();
        for (uint256 i = FIRST_PUBLIC_EXTENSION_ID; i < c; ++i) {
            if (TEE_EXTENSION_REGISTRY.getTeeExtensionInstructionsSender(i) == address(this)) {
                _extensionId = i;
                return;
            }
        }
        revert("Extension ID not found.");
    }

    /// @notice Declares the TEE identity whose ActionResult signatures this
    ///         contract accepts. Taken from the proxy /info endpoint once the
    ///         machine reaches production.
    /// @param _teeAddress Signing address of the registered TEE machine.
    function setTeeAddress(address _teeAddress) external {
        require(msg.sender == OWNER, "not owner");
        require(_teeAddress != address(0), "zero TEE address");
        teeAddress = _teeAddress;
        emit TeeAddressSet(_teeAddress);
    }

    /// @notice Registers an encrypted mandate and asks the enclave to provision it.
    /// @dev The ciphertext is wrapped with the mandate id and this contract's
    ///      address in cleartext so the enclave can correlate its answer. FCC has
    ///      no result callback, so correlation has to travel inside the payload.
    /// @param _encryptedMandate Mandate JSON, ECIES-encrypted to the TEE public key.
    /// @return mandateId Identifier of the newly created mandate.
    function createMandate(bytes calldata _encryptedMandate) external payable returns (uint256 mandateId) {
        require(_encryptedMandate.length > 0, "empty mandate");

        mandateId = _mandates.length;
        _mandates.push(
            Mandate({
                owner: msg.sender,
                blobHash: keccak256(_encryptedMandate),
                depositAddress: "",
                status: MandateStatus.CREATED,
                createdAt: uint64(block.timestamp),
                filledDrops: 0,
                lastReportAt: 0
            })
        );

        emit MandateCreated(mandateId, msg.sender, keccak256(_encryptedMandate));

        _send(OP_COMMAND_CREATE_MANDATE, abi.encode(mandateId, address(this), _encryptedMandate));
    }

    /// @notice Cancels a mandate. The on-chain status is authoritative: the
    ///         enclave re-reads it before every signature, so a cancellation
    ///         lands even if the notification instruction is never delivered.
    /// @param _mandateId Mandate to cancel.
    function cancelMandate(uint256 _mandateId) external payable {
        require(_mandateId < _mandates.length, "no such mandate");
        Mandate storage mandate = _mandates[_mandateId];
        require(msg.sender == mandate.owner, "not mandate owner");
        require(
            mandate.status != MandateStatus.CANCELLED && mandate.status != MandateStatus.SETTLED,
            "mandate already closed"
        );

        mandate.status = MandateStatus.CANCELLED;
        emit MandateCancelled(_mandateId, msg.sender);

        _send(OP_COMMAND_CANCEL_MANDATE, abi.encode(_mandateId, address(this)));
    }

    /// @notice Delivers the encrypted enclave master seed, from which every
    ///         per-mandate XRPL key is derived. Sent once per TEE machine.
    /// @param _encryptedSeed 32 byte seed, ECIES-encrypted to the TEE public key.
    function initSeed(bytes calldata _encryptedSeed) external payable {
        require(msg.sender == OWNER, "not owner");
        require(_encryptedSeed.length > 0, "empty seed");
        _send(OP_COMMAND_INIT_SEED, _encryptedSeed);
    }

    /// @notice Asks the enclave to produce a signed execution report for a
    ///         mandate. The answer is relayed back through applyExecutionReport.
    /// @param _mandateId Mandate to report on.
    function requestReport(uint256 _mandateId) external payable {
        require(_mandateId < _mandates.length, "no such mandate");
        _send(OP_COMMAND_REPORT, abi.encode(_mandateId, address(this)));
    }

    /// @notice Declares the FDC verification contract used for XRPL proofs.
    /// @param _fdcVerification Address of FdcVerification on this network.
    function setFdcVerification(address _fdcVerification) external {
        require(msg.sender == OWNER, "not owner");
        require(_fdcVerification != address(0), "zero FDC address");
        fdcVerification = IFdcVerification(_fdcVerification);
        emit FdcVerificationSet(_fdcVerification);
    }

    /// @notice Proves that the user funded a mandate's deposit address on XRPL.
    /// @dev The funding is established by the enshrined data protocol rather
    ///      than asserted by the TEE, which is the whole point of routing it
    ///      through FDC. Permissionless: the proof is the authorisation.
    /// @param _mandateId Mandate being funded.
    /// @param _proof FDC XRPPayment proof of the deposit transaction.
    function proveDeposit(uint256 _mandateId, IXRPPayment.Proof calldata _proof) external {
        Mandate storage mandate = _requireProvableMandate(_mandateId, _proof);
        require(mandate.status == MandateStatus.PROVISIONED, "mandate not awaiting funding");

        IXRPPayment.ResponseBody calldata body = _proof.data.responseBody;
        require(body.receivingAddressHash == _standardAddressHash(mandate.depositAddress),
            "payment not sent to the deposit address");
        require(body.hasDestinationTag && body.destinationTag == _mandateId,
            "payment does not carry the mandate destination tag");
        require(body.receivedAmount > 0, "no value received");

        provenTransactions[_proof.data.requestBody.transactionId] = true;
        mandate.status = MandateStatus.FUNDED;

        emit MandateFunded(
            _mandateId, uint256(body.receivedAmount), _proof.data.requestBody.transactionId
        );
    }

    /// @notice Proves that the enclave paid a mandate's proceeds out to the
    ///         user, which is what closes the mandate.
    /// @param _mandateId Mandate being settled.
    /// @param _proof FDC XRPPayment proof of the settlement transaction.
    function proveSettlement(uint256 _mandateId, IXRPPayment.Proof calldata _proof) external {
        Mandate storage mandate = _requireProvableMandate(_mandateId, _proof);
        require(
            mandate.status == MandateStatus.FILLED ||
                mandate.status == MandateStatus.EXPIRED ||
                mandate.status == MandateStatus.CANCELLED,
            "mandate not ready to settle"
        );

        IXRPPayment.ResponseBody calldata body = _proof.data.responseBody;
        require(body.sourceAddressHash == _standardAddressHash(mandate.depositAddress),
            "settlement not sent from the deposit address");
        require(body.receivedAmount > 0, "no value delivered");

        provenTransactions[_proof.data.requestBody.transactionId] = true;
        mandate.status = MandateStatus.SETTLED;

        emit MandateSettled(
            _mandateId, uint256(body.receivedAmount), _proof.data.requestBody.transactionId
        );
    }

    /// @notice Shared checks for both FDC gated transitions.
    /// @dev Verifies the proof against the finalised Merkle root, refuses a
    ///      failed XRPL transaction, and refuses a transaction already spent as
    ///      a proof so the same payment cannot fund two mandates.
    function _requireProvableMandate(
        uint256 _mandateId,
        IXRPPayment.Proof calldata _proof
    ) private view returns (Mandate storage) {
        require(address(fdcVerification) != address(0), "FDC verification not set");
        require(_mandateId < _mandates.length, "no such mandate");
        require(!provenTransactions[_proof.data.requestBody.transactionId], "proof already used");
        // XRPPayment status 0 means the transaction succeeded.
        require(_proof.data.responseBody.status == 0, "XRPL transaction did not succeed");
        require(fdcVerification.verifyXRPPayment(_proof), "invalid FDC proof");
        return _mandates[_mandateId];
    }

    /// @notice Hash of an XRPL classic address as FDC reports it.
    /// @dev FDC calls this the standard address hash. Confirm the exact
    ///      encoding against a live proof before relying on it in production:
    ///      it is the one value here not taken from a machine-readable source.
    function _standardAddressHash(string memory _address) private pure returns (bytes32) {
        return keccak256(bytes(_address));
    }

    /// @notice Records the deposit address the enclave derived for a mandate.
    /// @dev Permissionless by design: the TEE signature is the authorisation, so
    ///      anyone may relay the result. The arguments are the four signed
    ///      ActionResult fields plus the signature over them.
    /// @param _resultData ABI-encoded (address contractAddress, uint256 mandateId, string depositAddress).
    /// @param _actionId Signed ActionResult id.
    /// @param _submissionTag Signed ActionResult submission tag.
    /// @param _status Signed ActionResult status. Only 1 (success) is accepted.
    /// @param _signature 65 byte TEE signature over the payload hash.
    function applyProvision(
        bytes calldata _resultData,
        bytes32 _actionId,
        string calldata _submissionTag,
        uint8 _status,
        bytes calldata _signature
    ) external {
        _requireTeeResult(_resultData, _actionId, _submissionTag, _status, _signature);

        (address contractAddress, uint256 mandateId, string memory depositAddress) =
            abi.decode(_resultData, (address, uint256, string));
        require(contractAddress == address(this), "result not for this contract");
        require(mandateId < _mandates.length, "no such mandate");
        require(bytes(depositAddress).length > 0, "empty deposit address");

        Mandate storage mandate = _mandates[mandateId];
        require(mandate.status == MandateStatus.CREATED, "mandate not awaiting provision");

        mandate.depositAddress = depositAddress;
        mandate.status = MandateStatus.PROVISIONED;
        mandate.lastReportAt = uint64(block.timestamp);

        emit MandateProvisioned(mandateId, depositAddress);
    }

    /// @notice Records an execution report signed by the enclave.
    /// @dev Reports are monotonic: filled size never decreases, and a mandate
    ///      that already reached a terminal state refuses further reports.
    /// @param _resultData ABI-encoded (address contractAddress, uint256 mandateId,
    ///        uint8 reportedStatus, uint64 filledDrops, bytes32 xrplTxHash).
    /// @param _actionId Signed ActionResult id.
    /// @param _submissionTag Signed ActionResult submission tag.
    /// @param _status Signed ActionResult status. Only 1 (success) is accepted.
    /// @param _signature 65 byte TEE signature over the payload hash.
    function applyExecutionReport(
        bytes calldata _resultData,
        bytes32 _actionId,
        string calldata _submissionTag,
        uint8 _status,
        bytes calldata _signature
    ) external {
        _requireTeeResult(_resultData, _actionId, _submissionTag, _status, _signature);

        (
            address contractAddress,
            uint256 mandateId,
            uint8 reportedStatus,
            uint64 filledDrops,
            bytes32 xrplTxHash
        ) = abi.decode(_resultData, (address, uint256, uint8, uint64, bytes32));
        require(contractAddress == address(this), "result not for this contract");
        require(mandateId < _mandates.length, "no such mandate");

        MandateStatus nextStatus = MandateStatus(reportedStatus);
        require(
            nextStatus == MandateStatus.EXECUTING ||
                nextStatus == MandateStatus.FILLED ||
                nextStatus == MandateStatus.EXPIRED,
            "status not reportable by the TEE"
        );

        Mandate storage mandate = _mandates[mandateId];
        require(
            mandate.status == MandateStatus.FUNDED || mandate.status == MandateStatus.EXECUTING,
            "mandate not executable"
        );
        require(filledDrops >= mandate.filledDrops, "filled size decreased");

        mandate.status = nextStatus;
        mandate.filledDrops = filledDrops;
        mandate.lastReportAt = uint64(block.timestamp);

        emit MandateExecuted(mandateId, nextStatus, filledDrops, xrplTxHash);
    }

    /// @notice Returns a mandate by id.
    /// @param _mandateId Mandate to read.
    /// @return The stored mandate record.
    function getMandate(uint256 _mandateId) external view returns (Mandate memory) {
        require(_mandateId < _mandates.length, "no such mandate");
        return _mandates[_mandateId];
    }

    /// @notice Number of mandates ever created.
    /// @return The mandate count.
    function mandateCount() external view returns (uint256) {
        return _mandates.length;
    }

    /// @notice Sends one instruction to a random TEE machine of this extension.
    /// @param _opCommand Command constant routing the instruction in the enclave.
    /// @param _message Payload delivered to the extension as originalMessage.
    function _send(bytes32 _opCommand, bytes memory _message) private {
        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);

        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_KERB,
            opCommand: _opCommand,
            message: _message,
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });

        TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(teeIds, params);
    }

    /// @notice Verifies that an ActionResult was signed by the declared TEE.
    /// @dev Mirrors ActionResult.Hash in the TEE node: only Data, ID,
    ///      SubmissionTag and Status are covered by the signature.
    function _requireTeeResult(
        bytes calldata _resultData,
        bytes32 _actionId,
        string calldata _submissionTag,
        uint8 _status,
        bytes calldata _signature
    ) private view {
        require(teeAddress != address(0), "TEE address not set");
        require(_status == 1, "TEE reported failure");

        bytes32 resultHash = keccak256(
            abi.encodePacked(keccak256(_resultData), _actionId, keccak256(bytes(_submissionTag)), _status)
        );
        bytes32 payloadHash = keccak256(abi.encode(TEE_ACTION_RESULT_PREFIX, block.chainid, resultHash));
        require(_recover(_ethSigned(payloadHash), _signature) == teeAddress, "bad TEE signature");
    }

    /// @notice Returns the cached extension ID, reverting if not yet set.
    /// @return The extension ID assigned to this contract.
    function _getExtensionId() internal view returns (uint256) {
        require(_extensionId != 0, "Extension ID is not set.");
        return _extensionId;
    }

    /// @notice Applies the standard Ethereum signed-message envelope.
    function _ethSigned(bytes32 _hash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", _hash));
    }

    /// @notice Recovers the signer of a 65 byte secp256k1 signature.
    function _recover(bytes32 _digest, bytes calldata _sig) private pure returns (address) {
        require(_sig.length == 65, "bad signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(_sig.offset)
            s := calldataload(add(_sig.offset, 32))
            v := byte(0, calldataload(add(_sig.offset, 64)))
        }
        if (v < 27) {
            v += 27;
        }
        require(v == 27 || v == 28, "bad signature v");
        address signer = ecrecover(_digest, v, r, s);
        require(signer != address(0), "invalid signature");
        return signer;
    }
}
