// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Isolated Anvil fixture, not a production ERC-4337 account or an audited session module.
contract ScopedAccountFixture {
    address public immutable owner;
    address public immutable session;
    struct Permission { address target; bytes4 selector; uint256 maximumValue; uint256 expiresAt; bytes32 calldataHash; bool used; }
    mapping(bytes32 => Permission) public permissions;
    constructor(address owner_, address session_) { owner = owner_; session = session_; }
    receive() external payable {}
    function grant(bytes32 id, address target, bytes4 selector, uint256 maximumValue, uint256 expiresAt, bytes32 calldataHash) external {
        require(msg.sender == owner && permissions[id].expiresAt == 0, "OWNER_AUTHORITY");
        permissions[id] = Permission(target, selector, maximumValue, expiresAt, calldataHash, false);
    }
    function execute(bytes32 id, address target, uint256 value, bytes calldata data) external returns (bytes memory) {
        Permission storage permission = permissions[id];
        require(msg.sender == session && !permission.used, "SESSION_AUTHORITY");
        require(block.timestamp < permission.expiresAt && target == permission.target, "TARGET_OR_EXPIRY");
        require(data.length >= 4 && bytes4(data[:4]) == permission.selector && keccak256(data) == permission.calldataHash, "EXACT_CALL");
        require(value <= permission.maximumValue, "VALUE_LIMIT");
        permission.used = true;
        (bool success, bytes memory result) = target.call{value: value}(data);
        require(success, "CALL_FAILED");
        return result;
    }
    function ownerCall(address target, uint256 value, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == owner, "OWNER_AUTHORITY");
        (bool success, bytes memory result) = target.call{value: value}(data);
        require(success, "CALL_FAILED");
        return result;
    }
    function withdrawToOwner(uint256 amount) external {
        require(msg.sender == owner || msg.sender == address(this), "OWNER_AUTHORITY");
        (bool success,) = payable(owner).call{value: amount}("");
        require(success, "TRANSFER");
    }
}
