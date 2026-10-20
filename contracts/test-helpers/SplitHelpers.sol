// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// ---------------------------------------------------------------------------
// RevertReceiver – always reverts on receive
// ---------------------------------------------------------------------------
contract RevertReceiver {
    receive() external payable {
        revert("I always revert");
    }
}

// ---------------------------------------------------------------------------
// GasBurner – burns all forwarded gas on receive
// ---------------------------------------------------------------------------
contract GasBurner {
    receive() external payable {
        // spin until out of gas
        uint256 i;
        while (true) {
            unchecked { ++i; }
        }
    }
}

// ---------------------------------------------------------------------------
// BigRevertReceiver – reverts with ~100 KB of data on receive
// ---------------------------------------------------------------------------
contract BigRevertReceiver {
    receive() external payable {
        bytes memory data = new bytes(100_000);
        assembly {
            revert(add(data, 32), mload(data))
        }
    }
}

// ---------------------------------------------------------------------------
// AcceptReceiver – a plain payable recipient (accepts all sends)
// ---------------------------------------------------------------------------
contract AcceptReceiver {
    receive() external payable {}
    function balance() external view returns (uint256) { return address(this).balance; }
}

// ---------------------------------------------------------------------------
// ReentrantReceiver
//
// On receive() it attempts to re-enter a configured function on UsdcSplit.
// Stores the last revert data so tests can inspect it.
//
// To arm it:
//   r.setTarget(address(split));
//   r.setFn(ReentrantReceiver.Fn.Pay);         // or any other Fn
//   r.setArg(splitId, extraArg);
// ---------------------------------------------------------------------------
interface IUsdcSplit {
    function createSplit(string calldata, address[] calldata, uint16[] calldata, address, uint64) external returns (uint256);
    function pay(uint256, string calldata) external payable returns (uint256);
    function payAtVersion(uint256, string calldata, uint32) external payable returns (uint256);
    function withdraw(uint256) external returns (uint256);
    function release(uint256, address) external returns (uint256);
    function distribute(uint256) external returns (uint256, uint256);
    function proposeChange(uint256, address[] calldata, uint16[] calldata) external;
    function cancelChange(uint256) external;
    function executeChange(uint256) external;
    function lockSplit(uint256) external;
}

contract ReentrantReceiver {
    enum Fn {
        CreateSplit,
        Pay,
        PayAtVersion,
        Withdraw,
        Release,
        Distribute,
        ProposeChange,
        CancelChange,
        ExecuteChange,
        LockSplit
    }

    IUsdcSplit public target;
    Fn         public fn;
    uint256    public splitId;
    uint256    public extraArg;        // version for PayAtVersion
    bool       public armed;
    bytes      public lastRevertData;

    // Recipients for CreateSplit re-entry
    address[2] public reentryAccounts;
    uint16[2]  public reentryBps;

    function setTarget(address t) external { target = IUsdcSplit(t); }
    function setFn(Fn f) external { fn = f; }
    function setArg(uint256 id, uint256 extra) external { splitId = id; extraArg = extra; }
    function setArmed(bool a) external { armed = a; }
    function setReentryRecipients(address a0, address a1) external {
        reentryAccounts[0] = a0; reentryAccounts[1] = a1;
        reentryBps[0] = 5000;   reentryBps[1] = 5000;
    }

    receive() external payable {
        if (!armed) return;
        armed = false; // prevent infinite loop

        bool ok;
        bytes memory data;

        if (fn == Fn.CreateSplit) {
            address[] memory accs = new address[](2);
            uint16[]  memory bps  = new uint16[](2);
            accs[0] = reentryAccounts[0]; accs[1] = reentryAccounts[1];
            bps[0]  = 5000;               bps[1]  = 5000;
            (ok, data) = address(target).call(
                abi.encodeCall(IUsdcSplit.createSplit, ("lbl", accs, bps, address(0), 0))
            );
        } else if (fn == Fn.Pay) {
            (ok, data) = address(target).call{value: 1}(
                abi.encodeCall(IUsdcSplit.pay, (splitId, ""))
            );
        } else if (fn == Fn.PayAtVersion) {
            (ok, data) = address(target).call{value: 1}(
                abi.encodeCall(IUsdcSplit.payAtVersion, (splitId, "", uint32(extraArg)))
            );
        } else if (fn == Fn.Withdraw) {
            (ok, data) = address(target).call(
                abi.encodeCall(IUsdcSplit.withdraw, (splitId))
            );
        } else if (fn == Fn.Release) {
            (ok, data) = address(target).call(
                abi.encodeCall(IUsdcSplit.release, (splitId, address(this)))
            );
        } else if (fn == Fn.Distribute) {
            (ok, data) = address(target).call(
                abi.encodeCall(IUsdcSplit.distribute, (splitId))
            );
        } else if (fn == Fn.ProposeChange) {
            address[] memory accs = new address[](2);
            uint16[]  memory bps  = new uint16[](2);
            accs[0] = reentryAccounts[0]; accs[1] = reentryAccounts[1];
            bps[0]  = 5000;               bps[1]  = 5000;
            (ok, data) = address(target).call(
                abi.encodeCall(IUsdcSplit.proposeChange, (splitId, accs, bps))
            );
        } else if (fn == Fn.CancelChange) {
            (ok, data) = address(target).call(
                abi.encodeCall(IUsdcSplit.cancelChange, (splitId))
            );
        } else if (fn == Fn.ExecuteChange) {
            (ok, data) = address(target).call(
                abi.encodeCall(IUsdcSplit.executeChange, (splitId))
            );
        } else if (fn == Fn.LockSplit) {
            (ok, data) = address(target).call(
                abi.encodeCall(IUsdcSplit.lockSplit, (splitId))
            );
        }

        require(!ok, "expected revert");
        lastRevertData = data;
    }

    // Allow this contract to be funded
    function fund() external payable {}
}
