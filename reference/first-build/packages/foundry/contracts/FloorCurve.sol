// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "./FloorToken.sol";

interface IGraduationPool { function seed(address token, uint256 tokenAmount, address beneficiary) external payable returns (uint256); }

/// @notice Fee-free testnet bonding curve; the launch fee belongs to the factory, never to trades.
contract FloorCurve {
    FloorToken public immutable token;
    address public immutable launcher;
    address public immutable factory;
    IGraduationPool public immutable pool;
    uint256 public immutable threshold;
    uint256 public immutable virtualEth;
    uint256 public reserve;
    bool public graduated;
    bool private entered;
    event Bought(address indexed buyer, uint256 ethIn, uint256 tokensOut);
    event Sold(address indexed seller, uint256 tokensIn, uint256 ethOut);
    event Graduated(address indexed pool, uint256 liquidity);
    modifier guarded() { require(!entered, "REENTRANCY"); entered = true; _; entered = false; }

    constructor(string memory name_, string memory symbol_, uint256 supply_, address launcher_, uint256 allocation_, uint256 threshold_, uint256 virtualEth_, address pool_) {
        require(threshold_ > 0 && virtualEth_ > 0 && pool_.code.length > 0, "CONFIGURATION");
        launcher = launcher_; factory = msg.sender; pool = IGraduationPool(pool_); threshold = threshold_; virtualEth = virtualEth_;
        token = new FloorToken(name_, symbol_, supply_, launcher_, allocation_, address(this));
    }
    function buy(uint256 minimumTokens) external payable guarded {
        require(!graduated && msg.value > 0, "INACTIVE");
        uint256 tokensOut = token.balanceOf(address(this)) * msg.value / (virtualEth + reserve + msg.value);
        require(tokensOut > 0 && tokensOut >= minimumTokens, "SLIPPAGE");
        reserve += msg.value; require(token.transfer(msg.sender, tokensOut), "TRANSFER"); emit Bought(msg.sender, msg.value, tokensOut);
    }
    function sell(uint256 tokenAmount, uint256 minimumEth) external guarded {
        require(!graduated && tokenAmount > 0, "INACTIVE");
        uint256 ethOut = (virtualEth + reserve) * tokenAmount / (token.balanceOf(address(this)) + tokenAmount);
        require(ethOut > 0 && ethOut <= reserve && ethOut >= minimumEth, "SLIPPAGE_OR_RESERVE");
        // The token enforces the allocation lock even when its owner calls this function directly.
        require(token.transferFrom(msg.sender, address(this), tokenAmount), "TRANSFER"); reserve -= ethOut;
        (bool paid,) = payable(msg.sender).call{value: ethOut}(""); require(paid, "PAYMENT"); emit Sold(msg.sender, tokenAmount, ethOut);
    }
    function graduate() external guarded {
        require(!graduated && reserve >= threshold, "NOT_READY"); graduated = true;
        uint256 tokens = token.balanceOf(address(this)); uint256 eth = reserve; reserve = 0;
        require(token.approve(address(pool), tokens), "APPROVAL");
        uint256 liquidity = pool.seed{value: eth}(address(token), tokens, launcher);
        require(liquidity > 0 && token.balanceOf(address(this)) == 0, "POOL_NOT_SEEDED"); emit Graduated(address(pool), liquidity);
    }
}
