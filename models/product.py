# -*- coding: utf-8 -*-
# Extend POS product loading to expose per-product stock at the POS location
# as a precomputed field `pos_available_qty` in the POS UI.
#
# WHY:
# - We need a stock quantity that is:
#     - Computed in backend using the POS stock location / warehouse
#     - Loaded with the rest of POS data (works in offline mode)
#     - Available on `product.product` records in JS (no extra RPC on selection)
#
# HOW:
# - Extend `_load_pos_data_fields` to ensure we have type information.
# - Override `_process_pos_ui_product_product` to add `pos_available_qty`
#   to each product dict sent to the POS UI.

from odoo import api, models


class ProductProduct(models.Model):
    _inherit = "product.product"

    @api.model
    def _load_pos_data_fields(self, config_id):
        """Ensure POS receives product type info needed to distinguish storable vs others."""
        fields = list(super()._load_pos_data_fields(config_id))
        # These are usually already present, but we ensure they are there for safety.
        for extra in ["type", "is_storable"]:
            if extra not in fields:
                fields.append(extra)
        return fields

    def _process_pos_ui_product_product(self, products, config):
        """Add `pos_available_qty` (stock in the POS source location) to each storable product.

        - Uses stock.quant aggregated on the POS source location
          (config.picking_type_id.default_location_src_id), including child locations.
        - Values are frozen for the duration of the session (offline-compatible).
        """
        super()._process_pos_ui_product_product(products, config)

        if not products:
            return

        # `config` parameter can be either an ID (int) or a recordset
        # Handle both cases safely
        try:
            if isinstance(config, int):
                config = self.env["pos.config"].browse(config)
            elif not config:
                # If config is None/False, we can't proceed
                return
            
            # Ensure we have a valid config recordset
            if not config.exists():
                return
                
            picking_type = config.picking_type_id
            if not picking_type:
                return
                
            location = picking_type.default_location_src_id or (config.warehouse_id and config.warehouse_id.lot_stock_id)
            if not location:
                # No clear stock location: do not add any extra field to avoid wrong assumptions.
                return
        except Exception:
            # If anything goes wrong with config/location access, fail silently
            # to avoid breaking POS initialization
            return

        product_ids = [p["id"] for p in products]

        # Group quants by product in the POS source location hierarchy.
        quants = self.env["stock.quant"].read_group(
            [
                ("product_id", "in", product_ids),
                ("location_id", "child_of", location.id),
                ("company_id", "=", config.company_id.id),
            ],
            ["product_id", "quantity:sum"],
            ["product_id"],
        )
        qty_by_product = {q["product_id"][0]: q["quantity"] for q in quants}

        for p in products:
            # Always set pos_available_qty to ensure it exists in JS
            # Only storable products should be constrained (type = 'product' / is_storable)
            is_storable = p.get("is_storable") or p.get("type") == "product"
            if is_storable:
                # Set available quantity for storable products
                p["pos_available_qty"] = qty_by_product.get(p["id"], 0.0)
            else:
                # For consumables / services, set to None (becomes null in JS)
                # JS code checks for undefined/null to skip restriction
                p["pos_available_qty"] = None

