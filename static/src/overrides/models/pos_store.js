/** Restrict adding out-of-stock storable products to POS orders.
 *
 * WHY:
 *  - Centralizes checks at the POS store level so every code path
 *    that adds a product to an order goes through the same logic.
 *  - Uses `product.pos_available_qty` computed in backend so it works
 *    in offline mode (no extra RPC on product click / barcode scan).
 *
 * HOW:
 *  - Patches `PosStore.prototype.addLineToOrder`.
 *  - For storable products, compares:
 *      existing qty of that product on the order + requested qty
 *      vs `pos_available_qty` (POS stock location).
 *  - If insufficient, shows an AlertDialog and prevents line creation.
 */

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { _t } from "@web/core/l10n/translation";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

patch(PosStore.prototype, {
    async addLineToOrder(vals, order, opts = {}, configure = true) {
        let product = vals.product_id;

        // Normalize product to a ProductProduct instance
        if (typeof product === "number") {
            product = this.data.models["product.product"].get(product);
        }

        if (product) {
            // Safely access product properties
            const isStorable = product.type === "product" || product.is_storable;
            // pos_available_qty might be in raw data or directly on product
            const available = product.pos_available_qty ?? product.raw?.pos_available_qty;

            // Only restrict:
            // - storable products
            // - when we actually have a precomputed stock value
            if (isStorable && available !== undefined && available !== null) {
                // Requested quantity for this line (default is 1)
                const requestedQty =
                    vals.qty !== undefined && vals.qty !== null ? Number(vals.qty) : 1;

                // Ignore negative / zero (returns / removals)
                if (requestedQty > 0) {
                    // Sum of quantities for same product already on the order
                    const currentQty = order.lines
                        .filter((l) => l.product_id.id === product.id)
                        .reduce((sum, l) => sum + (l.qty || 0), 0);

                    const futureTotal = currentQty + requestedQty;

                    if (available <= 0 || futureTotal - available > 1e-9) {
                        // Show standard POS-style popup
                        this.dialog.add(AlertDialog, {
                            title: _t("Hết hàng"),
                            body: _t(
                                'Sản phẩm "%s" đã hết hàng trong kho được chọn cho POS.\n' +
                                    "Tồn kho: %s, Yêu cầu: %s.",
                                product.display_name || product.name,
                                available,
                                futureTotal
                            ),
                        });
                        // Do not create the line
                        return;
                    }
                }
            }
        }

        // Fallback to core behavior if not restricted
        return await super.addLineToOrder(vals, order, opts, configure);
    },
});

