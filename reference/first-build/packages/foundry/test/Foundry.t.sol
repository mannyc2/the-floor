// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "../contracts/FloorFoundry.sol";
interface Vm { function warp(uint256) external; function deal(address, uint256) external; function prank(address) external; function expectRevert(bytes calldata) external; }
contract Pool is IGraduationPool {
    uint256 public nativeLiquidity;
    function seed(address token, uint256 amount, address) external payable returns (uint256) { require(FloorToken(token).transferFrom(msg.sender, address(this), amount)); nativeLiquidity += msg.value; return amount; }
}
contract FoundryTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant agent = address(0xA11CE); address constant owner = address(0xB0B); address constant buyer = address(0xCAFE);
    receive() external payable {}
    function makeCurve() internal returns (FloorCurve curve) {
        Pool pool = new Pool(); FloorFoundry factory = new FloorFoundry(payable(address(this)), address(pool), 0);
        factory.registerAccount(agent, owner); vm.prank(agent);
        curve = FloorCurve(factory.launch(keccak256("one"), "Tide", "TIDE", 1000000 ether, 100000 ether, 1 ether, 1 ether, keccak256("a sourced thesis")));
    }
    function testDirectTransferCannotEvadeSevenDayLock() external {
        FloorToken token = makeCurve().token(); vm.prank(agent); vm.expectRevert(bytes("ALLOCATION_LOCKED")); token.transfer(buyer, 1);
        vm.warp(token.unlockAt()); vm.prank(agent); require(token.transfer(buyer, 100000 ether)); require(token.balanceOf(buyer) == 100000 ether);
    }
    function testAllowanceCannotEvadeLock() external {
        FloorToken token = makeCurve().token(); vm.prank(agent); token.approve(buyer, type(uint256).max);
        vm.prank(buyer); vm.expectRevert(bytes("ALLOCATION_LOCKED")); token.transferFrom(agent, buyer, 1);
    }
    function testDirectCurveSaleCannotEvadeLock() external {
        FloorCurve curve = makeCurve(); vm.deal(buyer, 2 ether); vm.prank(buyer); curve.buy{value: 1 ether}(1);
        FloorToken token = curve.token(); vm.prank(agent); token.approve(address(curve), 100 ether); vm.prank(agent); vm.expectRevert(bytes("ALLOCATION_LOCKED")); curve.sell(100 ether, 0);
    }
    function testGraduationSeedsPoolAndDisablesCurve() external {
        FloorCurve curve = makeCurve(); vm.deal(buyer, 2 ether); vm.prank(buyer); curve.buy{value: 1 ether}(1); curve.graduate();
        require(curve.graduated()); require(curve.token().balanceOf(address(curve)) == 0); require(Pool(address(curve.pool())).nativeLiquidity() == 1 ether);
        vm.prank(buyer); vm.expectRevert(bytes("INACTIVE")); curve.buy{value: 1}(0);
    }
    function testPerAgentAndOwnerRateLimits() external {
        Pool pool = new Pool(); FloorFoundry factory = new FloorFoundry(payable(address(this)), address(pool), 0); factory.registerAccount(agent, owner);
        vm.prank(agent); factory.launch(keccak256("one"), "Tide", "TIDE", 1000000 ether, 100000 ether, 1 ether, 1 ether, bytes32(uint256(1)));
        vm.prank(agent); vm.expectRevert(bytes("RATE_LIMIT")); factory.launch(keccak256("two"), "Tide", "TIDE", 1000000 ether, 100000 ether, 1 ether, 1 ether, bytes32(uint256(1)));
        for (uint256 i = 1; i <= 2; i++) { address another = address(uint160(100 + i)); factory.registerAccount(another, owner); vm.prank(another); factory.launch(bytes32(i), "Tide", "TIDE", 1000000 ether, 100000 ether, 1 ether, 1 ether, bytes32(uint256(1))); }
        address fourth = address(104); factory.registerAccount(fourth, owner); vm.prank(fourth); vm.expectRevert(bytes("RATE_LIMIT")); factory.launch(keccak256("four"), "Tide", "TIDE", 1000000 ether, 100000 ether, 1 ether, 1 ether, bytes32(uint256(1)));
    }
    function testFuzzLockedBalanceCannotDecrease(uint96 requested) external {
        FloorToken token = makeCurve().token(); uint256 amount = uint256(requested) % 100000 ether + 1;
        vm.prank(agent); vm.expectRevert(bytes("ALLOCATION_LOCKED")); token.transfer(buyer, amount);
    }
}
