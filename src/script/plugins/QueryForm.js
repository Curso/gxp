/**
 * @requires plugins/Tool.js
 */

Ext.namespace("gxp.plugins");

gxp.plugins.QueryForm = Ext.extend(gxp.plugins.Tool, {
    
    /** api: ptype = gx_QueryForm */
    ptype: "gx_queryform",

    /** api: config[featureManager]
     *  ``String`` The id of the :class:`gxp.plugins.FeatureManager` to use
     *  with this tool.
     */
    featureManager: null,
    
    /** private: property[schema]
     *  ``GeoExt.data.AttributeStore``
     */
    schema: null,
    
    /** api: config[queryActionText]
     *  ``String``
     *  Text for query action (i18n).
     */
    queryActionText: "Query",

    /** api: config[queryMenuText]
     *  ``String``
     *  Text for query menu item (i18n).
     */
    queryMenuText: "Query layer",

    /** api: config[queryActionTip]
     *  ``String``
     *  Text for query action tooltip (i18n).
     */
    queryActionTip: "Query the selected layer",

    /** api: config[queryByLocationText]
     *  ``String``
     *  Text for query by location (i18n).
     */
    queryByLocationText: "Query by location",

    /** api: config[currentTextText]
     *  ``String``
     *  Text for query by current extent (i18n).
     */
    currentTextText: "Current extent",

    /** api: config[queryByAttributesText]
     *  ``String``
     *  Text for query by attributes (i18n).
     */
    queryByAttributesText: "Query by attributes",

    /** api: config[actions]
     *  ``Object`` By default, this tool creates a "Query" action to trigger
     *  the output of this tool's form. Set to null if you want to include
     *  the form permanently in your layout.
     */
    
    /** api: config[outputAction]
     *  ``Number`` By default, the "Query" action will trigger this tool's
     *  form output. There is no need to change this unless you configure
     *  custom ``actions``.
     */
    outputAction: 0,
    
    constructor: function(config) {
        Ext.applyIf(config, {
            actions: [{
                text: this.queryActionText,
                menuText: this.queryMenuText,
                iconCls: "gx-icon-find",
                tooltip: this.queryActionTip
            }]
        });
        gxp.plugins.QueryForm.superclass.constructor.apply(this, arguments);
    },

    /** api: method[addActions]
     */
    addActions: function(actions) {
        gxp.plugins.QueryForm.superclass.addActions.apply(this, arguments);
        // support custom actions
        if (this.actions) {
            this.target.tools[this.featureManager].on("layerchange", function(mgr, rec, schema) {
                for (var i=this.actions.length-1; i>=0; --i) {
                    this.actions[i].setDisabled(!schema);
                }
            }, this);
        }
    },

    /** api: method[addOutput]
     */
    addOutput: function(config) {
        var featureManager = this.target.tools[this.featureManager];

        config = Ext.apply({
            bodyStyle: "padding: 10px",
            layout: "form",
            autoScroll: true,
            items: [{
                xtype: "fieldset",
                ref: "spatialFieldset",
                title: this.queryByLocationText,
                checkboxToggle: true,
                items: [{
                    xtype: "textfield",
                    ref: "../extent",
                    anchor: "100%",
                    fieldLabel: this.currentTextText,
                    value: this.getFormattedMapExtent(),
                    readOnly: true
                }]
            }, {
                xtype: "fieldset",
                ref: "attributeFieldset",
                title: this.queryByAttributesText,
                checkboxToggle: true
            }],
            bbar: ["->", {
                text: this.queryActionText,
                iconCls: "gx-icon-find",
                handler: function() {
                    var filters = [];
                    if (queryForm.spatialFieldset.collapsed !== true) {
                        filters.push(new OpenLayers.Filter.Spatial({
                            type: OpenLayers.Filter.Spatial.BBOX,
                            property: featureManager.featureStore.geometryName,
                            value: this.target.mapPanel.map.getExtent()
                        }));
                    }
                    if (queryForm.attributeFieldset.collapsed !== true) {
                        var attributeFilter = queryForm.filterBuilder.getFilter();
                        attributeFilter && filters.push(attributeFilter);
                    }
                    featureManager.loadFeatures(filters.length > 1 ?
                        new OpenLayers.Filter.Logical({
                            type: OpenLayers.Filter.Logical.AND,
                            filters: filters
                        }) :
                        filters[0]
                    );
                },
                scope: this
            }]
        }, config || {});
        var queryForm = gxp.plugins.FeatureGrid.superclass.addOutput.call(this, config);
        
        var addFilterBuilder = function(mgr, rec, schema) {
            queryForm.attributeFieldset.removeAll();
            queryForm.setDisabled(!schema);
            if (schema) {
                queryForm.attributeFieldset.add({
                    xtype: "gx_filterbuilder",
                    ref: "../filterBuilder",
                    attributes: schema,
                    allowBlank: true,
                    allowGroups: false
                });
                queryForm.spatialFieldset.expand();
                queryForm.attributeFieldset.expand();
            } else {
                queryForm.attributeFieldset.collapse();
                queryForm.spatialFieldset.collapse();
            }
            queryForm.attributeFieldset.doLayout();
        };
        featureManager.on("layerchange", addFilterBuilder);
        addFilterBuilder(featureManager,
            featureManager.layerRecord, featureManager.schema
        );
        
        this.target.mapPanel.map.events.register("moveend", this, function() {
            queryForm.extent.setValue(this.getFormattedMapExtent());
        });
        
        return queryForm;
    },
    
    getFormattedMapExtent: function() {
        var extent = this.target.mapPanel.map.getExtent();
        return extent && extent.toArray().join(", ");
    }
        
});

Ext.preg(gxp.plugins.QueryForm.prototype.ptype, gxp.plugins.QueryForm);