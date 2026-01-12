# -*- coding: utf-8 -*-
# Custom module to restrict selling out-of-stock products in POS.

{
    "name": "POS Restrict Out of Stock",
    "version": "1.0.0",
    "category": "Sales/Point of Sale",
    "summary": "Prevent selling out-of-stock storable products in POS",
    "author": "Custom",
    "depends": ["point_of_sale", "stock"],
    "data": [
        # XML wrapper mainly for clarity; actual JS inclusion uses manifest assets.
        "views/assets.xml",
    ],
    "assets": {
        # Load our JS patches into the main POS bundle
        "point_of_sale._assets_pos": [
            "pos_restrict_out_of_stock/static/src/overrides/**/*",
        ],
    },
    "installable": True,
    "application": False,
    "license": "LGPL-3",
}

