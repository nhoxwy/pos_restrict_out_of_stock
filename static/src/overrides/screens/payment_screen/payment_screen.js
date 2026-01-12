/** Block payment if any storable product on the order exceeds available stock.
 *
 * WHY:
 *  - Requirement: if stock becomes insufficient while product is already in the order,
 *    payment must be blocked with a clear warning listing the problematic products.
 *  - At payment time we re-evaluate the order using the preloaded `pos_available_qty`
 *    snapshot (offline-compatible; no extra RPC here).
 *
 * HOW:
 *  - Patch `PaymentScreen.prototype._isOrderValid`.
 *  - First call the core implementation; if it returns false, we keep the answer.
 *  - If core validations pass, we scan order lines for storable products whose
 *    total quantity is higher than `pos_available_qty` and block with an AlertDialog.
 */

import { patch } from "@web/core/utils/patch";
import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { _t } from "@web/core/l10n/translation";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

patch(PaymentScreen.prototype, {
        async _isOrderValid(isForceValidate) {
            // Run all core validations first (empty order, payments, customer, etc.)
            const isValidCore = await super._isOrderValid(isForceValidate);
            if (!isValidCore) {
                return false;
            }

            const order = this.currentOrder;
            if (!order) {
                return false;
            }

            // Aggregate ordered quantities per product
            const totalByProductId = new Map();
            for (const line of order.get_orderlines()) {
                const product = line.get_product();
                if (!product) {
                    continue;
                }
                const isStorable = product.type === "product" || product.is_storable;
                // pos_available_qty might be in raw data or directly on product
                const available = product.pos_available_qty ?? product.raw?.pos_available_qty;

                // Only care about storable products with a known available qty snapshot.
                if (!isStorable || available === undefined || available === null) {
                    continue;
                }

                const current = totalByProductId.get(product.id) || 0;
                totalByProductId.set(product.id, current + line.get_quantity());
            }

            // Find products exceeding their available quantity
            const violations = [];
            for (const [productId, orderedQty] of totalByProductId.entries()) {
                const product = this.pos.models["product.product"].get(productId);
                if (!product) {
                    continue;
                }
                // pos_available_qty might be in raw data or directly on product
                const available = product.pos_available_qty ?? product.raw?.pos_available_qty;
                if (available === undefined || available === null) {
                    continue;
                }
                if (available <= 0 || orderedQty - available > 1e-9) {
                    violations.push({
                        name: product.display_name || product.name,
                        ordered: orderedQty,
                        available,
                    });
                }
            }

            if (violations.length) {
                const lines = violations.map(
                    (v) =>
                        _t(
                            '"%s": ordered %s, available %s',
                            v.name,
                            v.ordered,
                            v.available
                        )
                );

                this.dialog.add(AlertDialog, {
                    title: _t("Insufficient stock"),
                    body: _t(
                        "Không thể xác nhận đơn hàng vì các sản phẩm sau đã hết hàng trong kho được chọn cho POS:\n\n%s",
                        lines.join("\n")
                    ),
                });
                return false;
            }

            return true;
        },
    }
);

