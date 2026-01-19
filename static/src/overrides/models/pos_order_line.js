/** Restrict increasing quantity of existing order lines beyond available stock.
 *
 * WHY:
 *  - Users can raise quantity via the OrderSummary numpad or by merging lines.
 *  - `set_quantity` is the central place for quantity changes and already
 *    returns structured errors consumed by the UI (OrderSummary shows AlertDialog).
 *  - When lines merge, `set_quantity` is called with the new total quantity.
 *
 * HOW:
 *  - Patch `PosOrderline.prototype.set_quantity`.
 *  - Perform a stock check before delegating to the original implementation:
 *      - only applies to storable products
 *      - uses `order.get_orderlines()` to get actual merged state
 *      - uses `product.pos_available_qty` and total qty of that product on the order.
 *  - Block when new quantity > available.
 *  - If insufficient, return `{title, body}`; the UI shows our message and
 *    does not apply the change.
 */

import { PosOrderline } from "@point_of_sale/app/models/pos_order_line";
import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { parseFloat as parseFloatField } from "@web/views/fields/parsers";

patch(PosOrderline.prototype, {
    merge(orderline) {
        // Mark the incoming line so stock check can ignore its quantity
        // (it will be merged into this line and then deleted by core logic).
        orderline.__pos_stock_merge_source = true;
        return super.merge(orderline);
    },

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
        const available =
            product && (product.pos_available_qty ?? product.raw?.pos_available_qty);

        if (isStorable && available !== undefined && available !== null) {
            // We only restrict selling (positive qty); refunds/returns are allowed.
            if (quant > 0) {
                // Use order.get_orderlines() to get actual merged order lines
                const orderLines = this.order_id.get_orderlines();

                // Sum of quantities for same product on other lines (excluding current line
                // and any transient merge-source lines)
                const otherQty = orderLines
                    .filter(
                        (l) =>
                            l.id !== this.id &&
                            l.product_id.id === product.id &&
                            !l.__pos_stock_merge_source
                    )
                    .reduce((sum, l) => sum + (l.qty || 0), 0);

                // Total quantity after this change
                const futureTotal = otherQty + quant;


                const epsilon = 1e-6;
                // Block only if futureTotal > available (allow equal)
                if (available <= 0 || futureTotal > available + epsilon) {
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
});

