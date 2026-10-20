// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {UsdcSplit} from "../UsdcSplit.sol";
import {RevertReceiver} from "../test-helpers/SplitHelpers.sol";

/// @dev Stateful invariant handler for UsdcSplit.
///      Tracks ghost variables so the invariant suite can verify them.
contract UsdcSplitHandler is CommonBase, StdCheats, StdUtils {
    UsdcSplit        public split;
    RevertReceiver   public rejector;

    // Known actor addresses
    address[3] public creators;
    address[3] public payers;
    address[7] public recipients; // 6 EOAs + rejector

    // Tracked split ids
    uint256[] public splitIds;

    // Ghost: per-split total credited (sum of all earned)
    mapping(uint256 => uint256) public ghost_totalCredited;
    // Ghost: set of accounts that have ever earned in a split (for invariant 3)
    mapping(uint256 => address[]) public ghost_accounts;
    mapping(uint256 => mapping(address => bool)) public ghost_accountKnown;

    // Ghost: per-split initial controller (to check immutability)
    mapping(uint256 => address) public ghost_initialController;
    // Ghost: per-split initial recipients (if immutable)
    mapping(uint256 => address[]) public ghost_initialRecipients;
    mapping(uint256 => uint16[])  public ghost_initialBps;

    // Ghost: per-split maximum earned per account (to check credits never decrease)
    mapping(uint256 => mapping(address => uint256)) public ghost_maxEarned;

    constructor(
        UsdcSplit _split,
        address[3] memory _creators,
        address[3] memory _payers,
        address[6] memory _recipients
    ) {
        split    = _split;
        rejector = new RevertReceiver();

        creators = _creators;
        payers   = _payers;
        recipients[0] = _recipients[0];
        recipients[1] = _recipients[1];
        recipients[2] = _recipients[2];
        recipients[3] = _recipients[3];
        recipients[4] = _recipients[4];
        recipients[5] = _recipients[5];
        recipients[6] = address(rejector);

        // Fund actors
        for (uint256 i = 0; i < 3; i++) {
            deal(_creators[i], 1 ether);
            deal(_payers[i],   1000 ether);
        }
        for (uint256 i = 0; i < 6; i++) {
            deal(_recipients[i], 1 ether);
        }
    }

    // -----------------------------------------------------------------------
    // Action: createSplit
    // -----------------------------------------------------------------------
    function createSplit(uint256 creatorSeed, uint256 tableSeed, bool managed) external {
        address creator = creators[bound(creatorSeed, 0, 2)];

        // Build a 2-recipient table from tableSeed
        address a = recipients[bound(tableSeed,         0, 6)];
        address b = recipients[bound(tableSeed >> 8,    0, 6)];
        if (a == b) b = recipients[(bound(tableSeed >> 8, 0, 6) + 1) % 7];
        if (a == b) return; // skip if still same

        address[] memory accs = new address[](2);
        uint16[]  memory bps  = new uint16[](2);
        accs[0] = a; accs[1] = b;
        bps[0]  = 5000; bps[1] = 5000;

        address ctrl   = managed ? creator : address(0);
        uint64  delay  = managed ? 120 : 0;

        vm.prank(creator);
        try split.createSplit("h", accs, bps, ctrl, delay) returns (uint256 id) {
            splitIds.push(id);
            ghost_initialController[id] = ctrl;
            if (!managed) {
                // immutable: record initial table for invariant check
                ghost_initialRecipients[id].push(a);
                ghost_initialRecipients[id].push(b);
                ghost_initialBps[id].push(5000);
                ghost_initialBps[id].push(5000);
            }
        } catch {}
    }

    // -----------------------------------------------------------------------
    // Action: pay
    // -----------------------------------------------------------------------
    function pay(uint256 payerSeed, uint256 idSeed, uint128 rawAmount) external {
        if (splitIds.length == 0) return;
        address payer = payers[bound(payerSeed, 0, 2)];
        uint256 id    = splitIds[bound(idSeed, 0, splitIds.length - 1)];
        uint256 amount = bound(uint256(rawAmount), 1, 10 ether);

        deal(payer, address(payer).balance + amount);

        (, uint256[] memory preview) = split.previewPayment(id, amount);
        (address[] memory accs,)     = split.getRecipients(id);

        vm.prank(payer);
        try split.pay{value: amount}(id, "") {
            ghost_totalCredited[id] += amount;
            for (uint256 i = 0; i < accs.length; i++) {
                if (!ghost_accountKnown[id][accs[i]]) {
                    ghost_accountKnown[id][accs[i]] = true;
                    ghost_accounts[id].push(accs[i]);
                }
                (uint256 e,) = split.getAccount(id, accs[i]);
                if (e > ghost_maxEarned[id][accs[i]]) {
                    ghost_maxEarned[id][accs[i]] = e;
                }
                // suppress unused warning
                preview;
            }
        } catch {}
    }

    // -----------------------------------------------------------------------
    // Action: withdraw
    // -----------------------------------------------------------------------
    function withdraw(uint256 idSeed, uint256 acctSeed) external {
        if (splitIds.length == 0) return;
        uint256 id = splitIds[bound(idSeed, 0, splitIds.length - 1)];
        address[] memory accs = ghost_accounts[id];
        if (accs.length == 0) return;
        address acct = accs[bound(acctSeed, 0, accs.length - 1)];
        if (split.withdrawable(id, acct) == 0) return;
        vm.prank(acct);
        try split.withdraw(id) {} catch {}
    }

    // -----------------------------------------------------------------------
    // Action: release
    // -----------------------------------------------------------------------
    function release(uint256 idSeed, uint256 acctSeed) external {
        if (splitIds.length == 0) return;
        uint256 id = splitIds[bound(idSeed, 0, splitIds.length - 1)];
        address[] memory accs = ghost_accounts[id];
        if (accs.length == 0) return;
        address acct = accs[bound(acctSeed, 0, accs.length - 1)];
        if (split.withdrawable(id, acct) == 0) return;
        try split.release(id, acct) {} catch {}
    }

    // -----------------------------------------------------------------------
    // Action: distribute
    // -----------------------------------------------------------------------
    function distribute(uint256 idSeed) external {
        if (splitIds.length == 0) return;
        uint256 id = splitIds[bound(idSeed, 0, splitIds.length - 1)];
        try split.distribute(id) {} catch {}
    }

    // -----------------------------------------------------------------------
    // Action: proposeChange
    // -----------------------------------------------------------------------
    function proposeChange(uint256 idSeed, uint256 tableSeed) external {
        if (splitIds.length == 0) return;
        uint256 id = splitIds[bound(idSeed, 0, splitIds.length - 1)];
        UsdcSplit.Split memory s = split.getSplit(id);
        if (s.controller == address(0)) return;

        address a = recipients[bound(tableSeed,      0, 6)];
        address b = recipients[bound(tableSeed >> 8, 0, 6)];
        if (a == b) b = recipients[(bound(tableSeed >> 8, 0, 6) + 1) % 7];
        if (a == b) return;

        address[] memory accs = new address[](2); uint16[] memory bps = new uint16[](2);
        accs[0] = a; accs[1] = b; bps[0] = 5000; bps[1] = 5000;

        vm.prank(s.controller);
        try split.proposeChange(id, accs, bps) {} catch {}
    }

    // -----------------------------------------------------------------------
    // Action: cancelChange
    // -----------------------------------------------------------------------
    function cancelChange(uint256 idSeed) external {
        if (splitIds.length == 0) return;
        uint256 id = splitIds[bound(idSeed, 0, splitIds.length - 1)];
        UsdcSplit.Split memory s = split.getSplit(id);
        if (s.controller == address(0) || s.pendingEta == 0) return;
        vm.prank(s.controller);
        try split.cancelChange(id) {} catch {}
    }

    // -----------------------------------------------------------------------
    // Action: executeChange (only if ready)
    // -----------------------------------------------------------------------
    function executeChange(uint256 idSeed) external {
        if (splitIds.length == 0) return;
        uint256 id = splitIds[bound(idSeed, 0, splitIds.length - 1)];
        UsdcSplit.Split memory s = split.getSplit(id);
        if (s.pendingEta == 0 || block.timestamp < s.pendingEta) return;
        if (block.timestamp > uint256(s.pendingEta) + 7 days) return;
        try split.executeChange(id) {
            // Update ghost accounts for new recipients
            (address[] memory newAccs,) = split.getRecipients(id);
            for (uint256 i = 0; i < newAccs.length; i++) {
                if (!ghost_accountKnown[id][newAccs[i]]) {
                    ghost_accountKnown[id][newAccs[i]] = true;
                    ghost_accounts[id].push(newAccs[i]);
                }
            }
        } catch {}
    }

    // -----------------------------------------------------------------------
    // Action: lockSplit (rare)
    // -----------------------------------------------------------------------
    function lockSplit(uint256 idSeed) external {
        if (splitIds.length == 0) return;
        uint256 id = splitIds[bound(idSeed, 0, splitIds.length - 1)];
        UsdcSplit.Split memory s = split.getSplit(id);
        if (s.controller == address(0)) return;
        vm.prank(s.controller);
        try split.lockSplit(id) {} catch {}
    }

    // -----------------------------------------------------------------------
    // Action: warp
    // -----------------------------------------------------------------------
    function warp(uint256 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 0, 2 days));
    }

    // -----------------------------------------------------------------------
    // Helpers for invariant assertions
    // -----------------------------------------------------------------------
    function getSplitIds() external view returns (uint256[] memory) {
        return splitIds;
    }

    function getGhostAccounts(uint256 id) external view returns (address[] memory) {
        return ghost_accounts[id];
    }
}
