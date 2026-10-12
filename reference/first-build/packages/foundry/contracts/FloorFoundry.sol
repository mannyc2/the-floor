// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./FloorCurve.sol";

/// @notice Immutable testnet factory. A deployment authority verifies owner/account bindings before registration.
contract FloorFoundry {
    address public immutable registrar;
    address payable public immutable treasury;
    address public immutable graduationPool;
    uint256 public immutable launchFee;
    mapping(address => address) public accountOwner;
    mapping(address => mapping(uint256 => uint256)) public agentDailyLaunches;
    mapping(address => mapping(uint256 => uint256)) public ownerWeeklyLaunches;
    mapping(bytes32 => address) public launches;
    event Registered(address indexed account, address indexed owner);
    event Cast(bytes32 indexed id, address indexed account, address indexed owner, address curve, address token, bytes32 thesis);
    constructor(address payable treasury_, address pool_, uint256 fee_) {
        require(block.chainid == 84532 || block.chainid == 31337, "TESTNET_ONLY");
        require(treasury_ != address(0) && pool_.code.length > 0, "CONFIGURATION");
        registrar = msg.sender; treasury = treasury_; graduationPool = pool_; launchFee = fee_;
    }
    function registerAccount(address account, address owner) external {
        require(msg.sender == registrar && account != address(0) && owner != address(0), "AUTHORITY");
        require(accountOwner[account] == address(0), "OWNER_IMMUTABLE");
        accountOwner[account] = owner; emit Registered(account, owner);
    }
    function launch(bytes32 id, string calldata name, string calldata symbol, uint256 supply, uint256 allocation, uint256 threshold, uint256 virtualEth, bytes32 thesis) external payable returns (address) {
        address owner = accountOwner[msg.sender]; require(owner != address(0), "UNREGISTERED_ACCOUNT");
        require(launches[id] == address(0) && thesis != bytes32(0), "ID_OR_THESIS");
        require(bytes(name).length > 0 && bytes(name).length <= 64 && bytes(symbol).length > 0 && bytes(symbol).length <= 12, "NAME");
        require(msg.value == launchFee, "LAUNCH_FEE");
        uint256 day = block.timestamp / 1 days; uint256 week = block.timestamp / 7 days;
        require(agentDailyLaunches[msg.sender][day] < 1 && ownerWeeklyLaunches[owner][week] < 3, "RATE_LIMIT");
        agentDailyLaunches[msg.sender][day]++; ownerWeeklyLaunches[owner][week]++;
        FloorCurve curve = new FloorCurve(name, symbol, supply, msg.sender, allocation, threshold, virtualEth, graduationPool);
        launches[id] = address(curve); emit Cast(id, msg.sender, owner, address(curve), address(curve.token()), thesis);
        (bool paid,) = treasury.call{value: msg.value}(""); require(paid, "FEE_PAYMENT"); return address(curve);
    }
}
