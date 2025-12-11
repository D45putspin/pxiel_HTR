from typing import Optional

from hathor import (
    Address,
    Blueprint,
    Context,
    HATHOR_TOKEN_UID,
    NCDepositAction,
    NCFail,
    NCWithdrawalAction,
    Timestamp,
    export,
    public,
    view,
)

class OutOfBounds(NCFail):
    """Erro para quando as coordenadas (x, y) estão fora do tamanho do canvas."""
    pass

class InvalidColorFormat(NCFail):
    """Erro para quando o formato da cor é inválido."""
    pass

class FeeRequired(NCFail):
    """Erro para quando a taxa de pintura não é paga."""
    pass

@export
class PixelPlace(Blueprint):
    """
    Um Nano Contract que simula um canvas colaborativo onde usuários pagam
    uma taxa em HTR para colorir um pixel.
    """
    owner: Address
    size: int
    fee_htr: int
    paint_count: int
    fees_collected: int

    # Usando string como chave ao invés de tuple para evitar problemas de serialização
    pixels: dict[str, str]
    last_painted_by: dict[str, Address]
    last_painted_at: dict[str, Timestamp]

    @public
    def initialize(self, ctx: Context, size: int, fee_htr: int) -> None:
        """
        Inicializa o contrato. Chamado apenas uma vez na criação.
        """
        self.owner = ctx.get_caller_address()
        self.size = size
        self.fee_htr = fee_htr
        self.paint_count = 0
        self.fees_collected = 0
        self.pixels = {}
        self.last_painted_by = {}
        self.last_painted_at = {}

    def _make_key(self, x: int, y: int) -> str:
        """Helper para criar chave de dicionário a partir de coordenadas."""
        return f"{x},{y}"

    @public(allow_deposit=True)
    def paint(self, ctx: Context, x: int, y: int, color: str) -> None:
        """
        Pinta um pixel no canvas. Exige um depósito em HTR como taxa.
        """
        # Validações
        if not (0 <= x < self.size and 0 <= y < self.size):
            raise OutOfBounds("Coordenadas (x, y) fora dos limites do canvas.")

        if not (len(color) == 7 and color.startswith('#')):
            raise InvalidColorFormat("O formato da cor deve ser '#RRGGBB'.")

        # Verifica o pagamento da taxa
        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCDepositAction):
            raise FeeRequired("É necessário um depósito em HTR para pintar.")

        if action.amount < self.fee_htr:
            raise FeeRequired(f"Taxa mínima de {self.fee_htr} HTR centavos é necessária.")

        # Obtém informações do contexto
        caller_address = ctx.get_caller_address()
        current_timestamp = ctx.block.timestamp

        # Cria chave para o pixel
        key = self._make_key(x, y)

        # Atualiza o estado do contrato
        self.pixels[key] = color
        self.last_painted_by[key] = caller_address
        self.last_painted_at[key] = current_timestamp
        self.paint_count += 1
        self.fees_collected += action.amount

        # Emite evento - address pode ser convertido para string diretamente
        event_data = f'{{"event":"Paint","x":{x},"y":{y},"color":"{color}","fee":{action.amount}}}'
        self.syscall.emit_event(event_data.encode('utf-8'))

    @public(allow_withdrawal=True)
    def withdraw_fees(self, ctx: Context) -> None:
        """
        Permite que o 'owner' do contrato retire as taxas coletadas.
        """
        if ctx.get_caller_address() != self.owner:
            raise NCFail("Apenas o owner pode retirar as taxas.")

        action = ctx.get_single_action(HATHOR_TOKEN_UID)
        if not isinstance(action, NCWithdrawalAction):
            raise NCFail("Ação de retirada (withdrawal) esperada.")

        if action.amount > self.fees_collected:
            raise NCFail(f"Valor de retirada excede as taxas coletadas.")

        self.fees_collected -= action.amount

    @view
    def get_pixel_info(self, x: int, y: int) -> Optional[tuple[str, str, Timestamp]]:
        """Retorna os dados de um pixel específico: (cor, quem pintou, quando)."""
        key = self._make_key(x, y)
        if key in self.pixels:
            # FIX: Convert Address object to string using str()
            # This ensures the node can serialize the result to JSON
            return (
                self.pixels[key],
                str(self.last_painted_by[key]),
                self.last_painted_at[key],
            )
        return None

    @view
    def get_stats(self) -> tuple[int, int]:
        """Retorna as estatísticas do contrato."""
        return (self.paint_count, self.fees_collected)

    @view
    def get_owner(self) -> str:
        """Retorna o endereço do dono do contrato."""
        # FIX: Also ensure owner address is returned as string
        return str(self.owner)

    @view
    def get_canvas_size(self) -> int:
        """Retorna o tamanho do canvas."""
        return self.size

    @view
    def get_paint_fee(self) -> int:
        """Retorna a taxa atual para pintar um pixel."""
        return self.fee_htr
