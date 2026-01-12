/** Restrict increasing quantity of existing order lines beyond available stock.
 *
 * WHY:
 *  - Users can raise quantity via the OrderSummary numpad or by merging lines.
 *  - `set_quantity` is the central place for quantity changes and already
 *    returns structured errors consumed by the UI (OrderSummary shows AlertDialog).
 *
 * HOW:
 *  - Patch `PosOrderline.prototype.set_quantity`.
 *  - Perform a stock check before delegating to the original implementation:
 *      - only applies to storable products
 *      - uses `product.pos_available_qty` and total qty of that product on the order.
 *  - If insufficient, return `{title, body}`; the UI shows our message and
 *    does not apply the change.
 */

import { PosOrderline } from "@point_of_sale/app/models/pos_order_line";
import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { parseFloat as parseFloatField } from "@web/views/fields/parsers";

patch(PosOrderline.prototype, {
        set_quantity(quantity, keep_price) {
            // Compute target quantity numerically for stock check,
            // but let the original implementation handle all other constraints.
            const quant =
                typeof quantity === "number"
                    ? quantity
                    : parseFloatField("" + (quantity ? quantity : 0));

            const product = this.product_id;
            const isStorable = product && (product.type === "product" || product.is_storable);
            // pos_available_qty might be in raw data or directly on product
            const available = product && (product.pos_available_qty ?? product.raw?.pos_available_qty);

            if (isStorable && available !== undefined && available !== null) {
                // We only restrict selling (positive qty); refunds/returns are allowed.
                if (quant > 0) {
                    // Sum of other lines of the same product on the same order
                    const otherQty = this.order_id.lines
                        .filter((l) => l.id !== this.id && l.product_id.id === product.id)
                        .reduce((sum, l) => sum + (l.qty || 0), 0);

                    const futureTotal = otherQty + quant;
                    if (available <= 0 || futureTotal - available > 1e-9) {
                        return {
                            title: _t("Hết hàng"),
                            body: _t(
                                'Không thể đặt số lượng của "%s" là %s.\n' +
                                    "Chỉ còn %s sản phẩm trong kho được chọn cho POS.",
                                product.display_name || product.name,
                                quant,
                                available
                            ),
                        };
                    }
                }
            }

            // Delegate to the original implementation for rounding,
            // refund rules, price recomputation, etc.
            return super.set_quantity(quantity, keep_price);
        },
    }
);

