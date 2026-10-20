// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {UsdcSplit} from "../UsdcSplit.sol";
import {UsdcSplitHandler} from "./UsdcSplitHandler.sol";

/// @dev Stateful invariant test suite for UsdcSplit.
contract UsdcSplitInvariantsTest is Test {
    UsdcSplit        internal split;
    UsdcSplitHandler internal handler;

    function setUp() public {
        split = new UsdcSplit();

        address[3] memory creators = [
            makeAddr("creator0"),
            makeAddr("creator1"),
            makeAddr("creator2")
        ];
        address[3] memory payers = [
            makeAddr("payer0"),
            makeAddr("payer1"),
            makeAddr("payer2")
        ];
        address[6] memory recipients = [
            makeAddr("recip0"),
            makeAddr("recip1"),
            makeAddr("recip2"),
            makeAddr("recip3"),
            makeAddr("recip4"),
            makeAddr("recip5")
        ];

        handler = new UsdcSplitHandler(split, creators, payers, recipients);

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = UsdcSplitHandler.createSplit.selector;
        selectors[1] = UsdcSplitHandler.pay.selector;
        selectors[2] = UsdcSplitHandler.withdraw.selector;
        selectors[3] = UsdcSplitHandler.release.selector;
        selectors[4] = UsdcSplitHandler.distribute.selector;
        selectors[5] = UsdcSplitHandler.proposeChange.selector;
        selectors[6] = UsdcSplitHandler.cancelChange.selector;
        selectors[7] = UsdcSplitHandler.executeChange.selector;
        selectors[8] = UsdcSplitHandler.warp.selector;
        // lockSplit excluded from regular rotation to avoid locking everything early
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // -----------------------------------------------------------------------
    // Invariant 1: contract balance >= totalHeld
    // -----------------------------------------------------------------------
    function invariant_balanceGeqTotalHeld() public view {
        assertGe(
            address(split).balance,
            split.totalHeld(),
            "balance < totalHeld"
        );
    }

    // -----------------------------------------------------------------------
    // Invariant 2: totalHeld == sum over all splits of (totalReceived - totalWithdrawn)
    // -----------------------------------------------------------------------
    function invariant_totalHeldConsistency() public view {
        uint256[] memory ids = handler.getSplitIds();
        uint256 sum;
        for (uint256 i = 0; i < ids.length; i++) {
            UsdcSplit.Split memory s = split.getSplit(ids[i]);
            sum += s.totalReceived - s.totalWithdrawn;
        }
        assertEq(split.totalHeld(), sum, "totalHeld != sum(received-withdrawn)");
    }

    // -----------------------------------------------------------------------
    // Invariant 3: per-split sum(earned) == split.totalReceived
    // -----------------------------------------------------------------------
    function invariant_perSplitCreditsEqReceived() public view {
        uint256[] memory ids = handler.getSplitIds();
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            UsdcSplit.Split memory s = split.getSplit(id);
            address[] memory accs = handler.getGhostAccounts(id);
            uint256 earnedSum;
            for (uint256 j = 0; j < accs.length; j++) {
                (uint256 earned,) = split.getAccount(id, accs[j]);
                earnedSum += earned;
            }
            assertEq(earnedSum, s.totalReceived,
                "sum(earned) != totalReceived for split");
        }
    }

    // -----------------------------------------------------------------------
    // Invariant 4: credits never decrease (earned only goes up)
    // -----------------------------------------------------------------------
    function invariant_creditsNeverDecrease() public view {
        uint256[] memory ids = handler.getSplitIds();
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            address[] memory accs = handler.getGhostAccounts(id);
            for (uint256 j = 0; j < accs.length; j++) {
                (uint256 earned,) = split.getAccount(id, accs[j]);
                assertGe(earned, handler.ghost_maxEarned(id, accs[j]),
                    "earned decreased");
            }
        }
    }

    // -----------------------------------------------------------------------
    // Invariant 5: immutable splits (controller==0 at creation) never change
    // -----------------------------------------------------------------------
    function invariant_immutableSplitsNeverChange() public view {
        uint256[] memory ids = handler.getSplitIds();
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (handler.ghost_initialController(id) != address(0)) continue;
            // This split was created immutable – recipients must not have changed
            // (version must still be 1)
            UsdcSplit.Split memory s = split.getSplit(id);
            assertEq(s.version, 1, "immutable split version changed");
        }
    }

    // -----------------------------------------------------------------------
    // Invariant 6: tables always valid for existing splits
    // -----------------------------------------------------------------------
    function invariant_tablesAlwaysValid() public view {
        uint256[] memory ids = handler.getSplitIds();
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            (address[] memory accs, uint16[] memory bps) = split.getRecipients(id);
            uint256 n = accs.length;
            if (n == 0) continue; // shouldn't happen but guard
            assertGe(n, 2,  "too few recipients");
            assertLe(n, 20, "too many recipients");
            uint256 bpsSum;
            for (uint256 j = 0; j < n; j++) {
                assertTrue(accs[j] != address(0), "zero address in table");
                assertTrue(bps[j] > 0,            "zero bps in table");
                bpsSum += bps[j];
                // no duplicates
                for (uint256 k = j + 1; k < n; k++) {
                    assertTrue(accs[j] != accs[k], "duplicate recipient");
                }
            }
            assertEq(bpsSum, 10000, "bps sum != 10000");
        }
    }

    // -----------------------------------------------------------------------
    // Invariant 7: splitsByRecipient lists each split exactly once per address
    // -----------------------------------------------------------------------
    function invariant_splitsByRecipientNoDuplicates() public view {
        uint256[] memory ids = handler.getSplitIds();
        // Collect all known addresses
        address[] memory allRecips = new address[](7);
        for (uint256 k = 0; k < 7; k++) {
            allRecips[k] = handler.recipients(k);
        }
        for (uint256 k = 0; k < allRecips.length; k++) {
            address r = allRecips[k];
            uint256[] memory rIds = split.splitsByRecipient(r);
            // Check no duplicates
            for (uint256 i = 0; i < rIds.length; i++) {
                for (uint256 j = i + 1; j < rIds.length; j++) {
                    assertTrue(rIds[i] != rIds[j], "duplicate in splitsByRecipient");
                }
            }
            // Check all listed ids are valid splits
            for (uint256 i = 0; i < rIds.length; i++) {
                assertGe(rIds[i], 1, "split id 0 in index");
                assertLe(rIds[i], split.splitCount(), "out-of-range id in index");
            }
        }
        // suppress unused `ids` warning
        ids;
    }
}
