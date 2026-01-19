/** Restrict adding out-of-stock storable products to POS orders.
 *
 * WHY:
 *  - Centralizes checks at the POS store level so every code path
 *    that adds a product to an order goes through the same logic.
 *  - Uses `product.pos_available_qty` computed in backend so it works
 *    in offline mode (no extra RPC on product click / barcode scan).
 *
 * HOW:
 *  - Patches `PosStore.prototype.addLineToCurrentOrder`.
 *  - For storable products, validates stock BEFORE calling core logic.
 *  - Core POS handles line creation and merging.
 *  - Only blocks if futureTotal > available.
 */

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { _t } from "@web/core/l10n/translation";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

patch(PosStore.prototype, {
    async addLineToCurrentOrder(vals, opts = {}, configure = true) {
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
                    // Get current order
                    let order = this.get_order();
                    if (!order) {
                        order = this.add_new_order();
                    }

                    // Use order.get_orderlines() to get actual order lines (reflects merged state)
                    const orderLines = order.get_orderlines();

                    // Sum of quantities for same product already on the order
                    const currentQty = orderLines
                        .filter((line) => line.product_id && line.product_id.id === product.id)
                        .reduce((sum, line) => sum + (line.qty || 0), 0);

                    const futureTotal = currentQty + requestedQty;


                    const epsilon = 1e-6;
                    // Block only if futureTotal > available (allow equal)
                    if (available <= 0 || futureTotal > available + epsilon) {
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

        // Let core POS handle line creation and merging
        return await super.addLineToCurrentOrder(vals, opts, configure);
    },
});

