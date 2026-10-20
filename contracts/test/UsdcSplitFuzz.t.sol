// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {UsdcSplit} from "../UsdcSplit.sol";

/// @dev Fuzz tests for the credit rule and drain invariant.
contract UsdcSplitFuzzTest is Test {
    UsdcSplit internal split;

    address internal payer = makeAddr("payer");

    function setUp() public {
        split = new UsdcSplit();
        vm.deal(payer, type(uint128).max);
    }

    // -----------------------------------------------------------------------
    // Helper: build a valid table of `n` recipients from a seed.
    // Recipients are deterministic addresses; bps sums to 10000.
    // -----------------------------------------------------------------------
    function _buildTable(uint8 n, uint256 seed)
        internal
        pure
        returns (address[] memory accs, uint16[] memory bps)
    {
        accs = new address[](n);
        bps  = new uint16[](n);

        // Assign each address a unique slot derived from seed
        for (uint256 i = 0; i < n; i++) {
            accs[i] = address(uint160(uint256(keccak256(abi.encode(seed, i))) | 0x1)); // ensure non-zero
        }

        // Distribute 10000 bps: give each recipient an equal floor share,
        // then add the remainder to recipient 0 so it sums to 10000 exactly.
        uint16 base = uint16(10000 / n);
        uint16 rem  = uint16(10000 - uint256(base) * n);
        for (uint256 i = 0; i < n; i++) {
            bps[i] = base;
        }
        bps[0] = base + rem;
    }

    // -----------------------------------------------------------------------
    // fuzz: credit rule – credits sum to amount, per-recipient amounts match rule
    // -----------------------------------------------------------------------
    function testFuzz_creditRule(uint8 rawN, uint256 amount, uint256 seed) public {
        // Bound n to [2, 20]
        uint8 n = uint8(bound(uint256(rawN), 2, 20));
        // Bound amount to [1, 1e24]
        amount = bound(amount, 1, 1e24);

        (address[] memory accs, uint16[] memory bps) = _buildTable(n, seed);

        // Check for duplicate addresses (possible with small n and unlucky seed)
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = i + 1; j < n; j++) {
                vm.assume(accs[i] != accs[j]);
            }
            vm.assume(accs[i] != address(0));
            vm.assume(accs[i] != address(split));
        }

        uint256 id = split.createSplit("fuzz", accs, bps, address(0), 0);

        // previewPayment before paying
        (, uint256[] memory preview) = split.previewPayment(id, amount);

        vm.prank(payer);
        split.pay{value: amount}(id, "");

        // Verify credits
        uint256 creditSum;
        for (uint256 i = 0; i < n; i++) {
            uint256 w = split.withdrawable(id, accs[i]);
            creditSum += w;
            // Verify preview matches actual
            assertEq(preview[i], w, "preview mismatch");
        }
        // Credits sum exactly to amount
        assertEq(creditSum, amount, "credits don't sum to amount");

        // Verify credit rule: i>=1 get floor(amount*bps/10000), i=0 gets remainder
        uint256 othersSum;
        for (uint256 i = 1; i < n; i++) {
            uint256 expected = (amount * uint256(bps[i])) / 10000;
            assertEq(split.withdrawable(id, accs[i]), expected, "wrong credit for i>=1");
            othersSum += expected;
        }
        uint256 expected0 = amount - othersSum;
        assertEq(split.withdrawable(id, accs[0]), expected0, "wrong credit for i=0");
    }

    // -----------------------------------------------------------------------
    // fuzz: many payments then full drain leaves 0
    // -----------------------------------------------------------------------
    function testFuzz_manyPaymentsThenDrain(uint8 rawN, uint8 rawPayments, uint128 baseAmount, uint256 seed) public {
        uint8 n        = uint8(bound(uint256(rawN), 2, 10)); // keep small for gas
        uint8 nPay     = uint8(bound(uint256(rawPayments), 1, 10));
        uint256 amount = bound(uint256(baseAmount), 1, 1e18);

        (address[] memory accs, uint16[] memory bps) = _buildTable(n, seed);
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = i + 1; j < n; j++) {
                vm.assume(accs[i] != accs[j]);
            }
            vm.assume(accs[i] != address(0));
            vm.assume(accs[i] != address(split));
        }

        uint256 id = split.createSplit("drain", accs, bps, address(0), 0);

        // Make nPay payments
        for (uint256 p = 0; p < nPay; p++) {
            vm.prank(payer);
            split.pay{value: amount}(id, "");
        }

        // Each recipient withdraws
        uint256 totalWithdrawn;
        for (uint256 i = 0; i < n; i++) {
            uint256 w = split.withdrawable(id, accs[i]);
            if (w > 0) {
                uint256 before = accs[i].balance;
                vm.prank(accs[i]);
                split.withdraw(id);
                assertEq(accs[i].balance - before, w);
                totalWithdrawn += w;
            }
        }

        // Total held should be 0 after full drain
        assertEq(split.totalHeld(), 0, "totalHeld not zero after drain");

        // Total withdrawn == total paid
        assertEq(totalWithdrawn, amount * nPay, "total withdrawn != total paid");
    }

    // -----------------------------------------------------------------------
    // fuzz: previewPayment always matches pay for any valid table
    // -----------------------------------------------------------------------
    function testFuzz_previewMatchesPay(uint16 b0, uint256 amount) public {
        // Build a 2-recipient table with bps [b0, 10000-b0], b0 in [1,9999]
        b0 = uint16(bound(uint256(b0), 1, 9999));
        amount = bound(amount, 1, 1e24);

        address[] memory accs = new address[](2);
        uint16[]  memory bps  = new uint16[](2);
        accs[0] = makeAddr("fpa"); accs[1] = makeAddr("fpb");
        bps[0] = b0; bps[1] = 10000 - b0;

        uint256 id = split.createSplit("prev", accs, bps, address(0), 0);

        (, uint256[] memory preview) = split.previewPayment(id, amount);
        vm.prank(payer);
        split.pay{value: amount}(id, "");

        assertEq(preview[0], split.withdrawable(id, accs[0]));
        assertEq(preview[1], split.withdrawable(id, accs[1]));
        assertEq(preview[0] + preview[1], amount);
    }
}
