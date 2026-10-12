// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Testnet launch token. Allocation restrictions apply to every transfer path, including transferFrom.
contract FloorToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;
    address public immutable launcher;
    uint256 public immutable lockedAllocation;
    uint256 public immutable unlockAt;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint256 supply_, address launcher_, uint256 allocation_, address curve_) {
        require(block.chainid == 84532 || block.chainid == 31337, "TESTNET_ONLY");
        require(launcher_ != address(0) && curve_ != address(0), "ZERO_ADDRESS");
        require(supply_ > 0 && allocation_ < supply_, "ALLOCATION_MUST_LEAVE_CURVE_SUPPLY");
        name = name_; symbol = symbol_; totalSupply = supply_; launcher = launcher_;
        lockedAllocation = allocation_; unlockAt = block.timestamp + 7 days;
        balanceOf[launcher_] = allocation_; balanceOf[curve_] = supply_ - allocation_;
        emit Transfer(address(0), launcher_, allocation_); emit Transfer(address(0), curve_, supply_ - allocation_);
    }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; emit Approval(msg.sender, spender, amount); return true; }
    function transfer(address to, uint256 amount) external returns (bool) { _transfer(msg.sender, to, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender]; require(allowed >= amount, "ALLOWANCE");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount); return true;
    }
    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0) && balanceOf[from] >= amount, "BALANCE_OR_ADDRESS");
        uint256 remaining = balanceOf[from] - amount;
        require(from != launcher || block.timestamp >= unlockAt || remaining >= lockedAllocation, "ALLOCATION_LOCKED");
        balanceOf[from] = remaining; balanceOf[to] += amount; emit Transfer(from, to, amount);
    }
}
