// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);

    function initialize(InitializeParams calldata params) external returns (int24);

    struct InitializeParams {
        PoolKey poolKey;
        uint160 sqrtPriceX96;
    }

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct ModifyLiquidityParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        bytes32 salt;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function modifyLiquidity(PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData)
        external
        returns (int256 callerDelta, int256 feesAccrued);

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        returns (int256 callerDelta);

    function donate(PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata hookData) external;
    function take(address token, address to, uint256 amount) external;
    function settle() external payable returns (uint256 paid);
    function sync(address token) external;
    function extsload(bytes32 slot) external view returns (bytes32 value);
    function exttload(bytes32[] calldata slots) external view returns (bytes32[] memory values);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract ForkHookExecutionTest is Test {
    bytes private _callbackData;
    int256 totalDelta;
    address constant MANAGER = 0x1F98400000000000000000000000000000000004;
    address constant HOOK = 0x6337fCa822066240064dAff387E61653AEEC90c8;
    address constant WBTC = 0x0555E30da8f98308EdB960aa94C0Db47230d2B9c;
    address constant USDC = 0x078D782b760474a361dDA0AF3839290b0EF57AD6;

    function setUp() external {
        deal(WBTC, address(this), 100_000_000_000e8);
        deal(USDC, address(this), 100_000_000_000e6);
        IERC20(WBTC).approve(MANAGER, type(uint256).max);
        IERC20(USDC).approve(MANAGER, type(uint256).max);
        deal(WBTC, address(this), 1_000_000_000e8);
        deal(USDC, address(this), 1_000_000_000e6);
    }

    function testSwapCreatesUnsettleableHookDebt() external {
        (bool ok, bytes memory result) = _unlock(abi.encode("swap"));
        assertFalse(ok, "unsettleable hook-owned delta unexpectedly allowed unlock");
        assertEq(_selector(result), hex"5212cba1", "expected CurrencyNotSettled");
    }

    function _selector(bytes memory data) private pure returns (bytes4) {
        require(data.length >= 4, "no selector");
        return bytes4(data);
    }

    function testDirectInnerCallRevertsOutsideLock() external {
        IPoolManager.ModifyLiquidityParams memory params =
            IPoolManager.ModifyLiquidityParams(-600, 600, 1_000_000, bytes32(0));
        (bool ok, bytes memory returnData) =
            MANAGER.call(abi.encodeCall(IPoolManager.modifyLiquidity, (poolKey(), params, "")));
        assertFalse(ok, "inner V4 operation unexpectedly succeeded outside lock");
        assertTrue(returnData.length >= 4, "expected selector-bearing revert");
    }

    function _unlock(bytes memory data) private returns (bool ok, bytes memory result) {
        _callbackData = data;
        (ok, result) = MANAGER.call(abi.encodeCall(IPoolManager.unlock, data));
        _callbackData = "";
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == MANAGER, "callback: unauthorized");
        require(keccak256(data) == keccak256(_callbackData), "callback: unknown action");

        try this.executeLifecycleForTest() {
            return "";
        } catch (bytes memory reason) {
            assembly ("memory-safe") {
                revert(add(reason, 32), mload(reason))
            }
        }
    }

    function executeLifecycleForTest() external {
        require(msg.sender == address(this), "lifecycle: unauthorized");
        (int256 addDelta,) = _modify(100);
        _payLeg(WBTC, amountLeg(addDelta, 0));
        _payLeg(USDC, amountLeg(addDelta, 1));
        IPoolManager(MANAGER).sync(WBTC);
        IPoolManager(MANAGER).settle();
        IPoolManager(MANAGER).sync(USDC);
        IPoolManager(MANAGER).settle();

        totalDelta = _swap();
    }

    function amountLeg(int256 packedDelta, uint256 index) private pure returns (int256) {
        uint256 shifted = index == 0 ? uint256(packedDelta) >> 128 : uint256(packedDelta) & type(uint128).max;
        return shifted & (1 << 127) == 0 ? int256(shifted) : -(int256((1 << 128) - shifted));
    }

    function _payLeg(address token, int256 amount) private {
        if (amount < 0) IERC20(token).transfer(MANAGER, uint256(-amount));
    }

    function poolKey() private pure returns (IPoolManager.PoolKey memory) {
        return IPoolManager.PoolKey({currency0: WBTC, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: HOOK});
    }

    function _swap() private returns (int256 callerDelta) {
        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: 100, sqrtPriceLimitX96: 4295128741});
        (bool ok, bytes memory result) = MANAGER.call(abi.encodeCall(IPoolManager.swap, (poolKey(), params, "")));
        require(ok, string(result));
        callerDelta = abi.decode(result, (int256));
    }

    function _modify(int256 liquidityDelta) private returns (int256 callerDelta, int256 feesAccrued) {
        IPoolManager.ModifyLiquidityParams memory params =
            IPoolManager.ModifyLiquidityParams(-887220, 887220, liquidityDelta, bytes32(0));
        (bool ok, bytes memory result) =
            MANAGER.call(abi.encodeCall(IPoolManager.modifyLiquidity, (poolKey(), params, "")));
        require(ok, string(result));
        (callerDelta, feesAccrued) = abi.decode(result, (int256, int256));
    }

    function _revertDataToString(bytes memory data) private pure returns (string memory) {
        return data.length == 0 ? "unknown revert" : string(data);
    }
}
