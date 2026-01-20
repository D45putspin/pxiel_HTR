import sys
import types
import unittest

# ---------------------------------------------------------------------------
# Lightweight stubs so tests can run even if the Hathor SDK is not installed.
# If the real SDK is present, it will be used instead.
# ---------------------------------------------------------------------------
try:  # pragma: no cover - best effort import
    import hathor  # type: ignore
except ImportError:  # pragma: no cover
    module = types.ModuleType("hathor")

    class NCFail(Exception):
        ...

    class NCDepositAction:
        def __init__(self, amount: int):
            self.amount = amount

    class NCWithdrawalAction:
        def __init__(self, amount: int):
            self.amount = amount

    class Address(str):
        ...

    class Timestamp(int):
        ...

    class Blueprint:
        def __init__(self):
            # syscall is used only for emit_event in the contract
            self.syscall = types.SimpleNamespace(emit_event=lambda *_args, **_kwargs: None)

    def export(cls):
        return cls

    def _maybe_return_fn(args, kwargs):
        return args and callable(args[0]) and not kwargs

    def public(*_args, **_kwargs):
        if _maybe_return_fn(_args, _kwargs):
            return _args[0]

        def decorator(fn):
            return fn

        return decorator

    def view(*_args, **_kwargs):
        if _maybe_return_fn(_args, _kwargs):
            return _args[0]

        def decorator(fn):
            return fn

        return decorator

    HATHOR_TOKEN_UID = "00"

    module.NCFail = NCFail
    module.NCDepositAction = NCDepositAction
    module.NCWithdrawalAction = NCWithdrawalAction
    module.Address = Address
    module.Timestamp = Timestamp
    module.Blueprint = Blueprint
    module.export = export
    module.public = public
    module.view = view
    module.HATHOR_TOKEN_UID = HATHOR_TOKEN_UID
    # Minimal Context stub; tests supply their own FakeContext
    module.Context = object

    sys.modules["hathor"] = module
    hathor = module

from contract.pixel_place import (  # noqa: E402
    EmptyBatch,
    FeeRequired,
    InvalidColorFormat,
    OutOfBounds,
    PixelPlace,
    HATHOR_TOKEN_UID,
    NCDepositAction,
)


class FakeBlock:
    def __init__(self, timestamp: int):
        self.timestamp = timestamp


class FakeContext:
    """
    Minimal context stub to drive PixelPlace logic.
    """

    def __init__(self, caller="addr1", actions=None, timestamp=1234):
        self._caller = caller
        self._actions = actions or {}
        self.block = FakeBlock(timestamp)

    def get_caller_address(self):
        return self._caller

    def get_single_action(self, token_uid):
        return self._actions.get(token_uid)


def make_deposit(amount: int) -> NCDepositAction:
    """
    Create a deposit action compatible with both the real SDK and the local stubs.
    """
    try:
        return NCDepositAction(HATHOR_TOKEN_UID, amount)  # type: ignore[arg-type]
    except Exception:
        try:
            return NCDepositAction(amount)  # type: ignore[arg-type]
        except Exception:
            class _DepositFallback(NCDepositAction):
                def __init__(self, amt: int):
                    super().__init__() if hasattr(super(), "__init__") else None
                    self.amount = amt

            return _DepositFallback(amount)


def new_contract():
    """
    Helper to create a contract with a writable syscall emitter.
    """
    contract = PixelPlace()
    contract.syscall = types.SimpleNamespace(emitted=[])
    contract.syscall.emit_event = lambda data: contract.syscall.emitted.append(data.decode("utf-8"))
    return contract


class PixelPlaceTests(unittest.TestCase):
    def test_initialize_sets_state(self):
        contract = new_contract()
        ctx = FakeContext(caller="owner1")

        contract.initialize(ctx, size=10, fee_htr=5)

        self.assertEqual(contract.owner, "owner1")
        self.assertEqual(contract.size, 10)
        self.assertEqual(contract.fee_htr, 5)
        self.assertEqual(contract.paint_count, 0)
        self.assertEqual(contract.fees_collected, 0)
        self.assertEqual(contract.pixels, {})
        self.assertEqual(contract.pixel_keys, [])

    def test_paint_updates_state_and_fee(self):
        contract = new_contract()
        contract.initialize(FakeContext(caller="owner1"), size=8, fee_htr=3)

        action = make_deposit(3)
        ctx = FakeContext(caller="addr1", actions={HATHOR_TOKEN_UID: action}, timestamp=99)

        contract.paint(ctx, 2, 3, "#abcdef")

        self.assertEqual(contract.pixels["2,3"], "#abcdef")
        self.assertEqual(contract.pixel_keys, ["2,3"])
        self.assertEqual(contract.last_painted_by["2,3"], "addr1")
        self.assertEqual(contract.last_painted_at["2,3"], 99)
        self.assertEqual(contract.paint_count, 1)
        self.assertEqual(contract.fees_collected, 3)
        self.assertTrue(contract.syscall.emitted)  # one event emitted

    def test_paint_rejects_invalid_inputs(self):
        contract = new_contract()
        contract.initialize(FakeContext(caller="owner1"), size=4, fee_htr=2)

        action = make_deposit(2)
        ctx = FakeContext(actions={HATHOR_TOKEN_UID: action})

        with self.assertRaises(OutOfBounds):
            contract.paint(ctx, 9, 0, "#ffffff")

        with self.assertRaises(InvalidColorFormat):
            contract.paint(ctx, 1, 1, "red")

    def test_paint_batch_successful(self):
        contract = new_contract()
        contract.initialize(FakeContext(caller="owner1"), size=10, fee_htr=2)

        action = make_deposit(6)  # 3 pixels * fee 2
        ctx = FakeContext(caller="addr2", actions={HATHOR_TOKEN_UID: action}, timestamp=55)

        contract.paint_batch(ctx, [0, 1, 2], [0, 1, 2], ["#000000", "#111111", "#222222"])

        self.assertEqual(contract.paint_count, 3)
        self.assertEqual(contract.fees_collected, 6)
        self.assertEqual(contract.pixel_keys, ["0,0", "1,1", "2,2"])
        self.assertEqual(contract.pixels["0,0"], "#000000")
        self.assertEqual(contract.pixels["1,1"], "#111111")
        self.assertEqual(contract.pixels["2,2"], "#222222")
        self.assertEqual(len(contract.syscall.emitted), 3)

    def test_paint_batch_validates_lengths_and_limits(self):
        contract = new_contract()
        contract.initialize(FakeContext(caller="owner1"), size=10, fee_htr=1)

        with self.assertRaises(EmptyBatch):
            contract.paint_batch(FakeContext(actions={}), [0, 1], [0], ["#aaaaaa"])

        big = list(range(40))
        with self.assertRaises(EmptyBatch):
            contract.paint_batch(FakeContext(actions={}), big, big, ["#aaaaaa"] * len(big))

    def test_paint_batch_requires_fee(self):
        contract = new_contract()
        contract.initialize(FakeContext(caller="owner1"), size=10, fee_htr=5)

        with self.assertRaises(FeeRequired):
            contract.paint_batch(FakeContext(actions={}), [0], [0], ["#ffffff"])

        action = make_deposit(3)  # needs 5
        ctx = FakeContext(actions={HATHOR_TOKEN_UID: action})
        with self.assertRaises(FeeRequired):
            contract.paint_batch(ctx, [0], [0], ["#ffffff"])

    def test_get_pixels_page_returns_painted_pixels(self):
        contract = new_contract()
        contract.initialize(FakeContext(caller="owner1"), size=10, fee_htr=1)

        action = make_deposit(3)
        ctx = FakeContext(caller="addr2", actions={HATHOR_TOKEN_UID: action}, timestamp=55)
        contract.paint_batch(ctx, [0, 1, 2], [0, 1, 2], ["#000000", "#111111", "#222222"])

        self.assertEqual(contract.get_pixels_count(), 3)
        page = contract.get_pixels_page(0, 2)
        self.assertEqual(len(page), 2)
        self.assertEqual(page[0], ["0,0", "#000000"])
        self.assertEqual(page[1], ["1,1", "#111111"])

        last = contract.get_pixels_page(2, 2)
        self.assertEqual(last, [["2,2", "#222222"]])

        empty = contract.get_pixels_page(10, 2)
        self.assertEqual(empty, [])


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
