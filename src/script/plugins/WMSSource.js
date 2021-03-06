/**
 * Copyright (c) 2008-2011 The Open Planning Project
 * 
 * Published under the GPL license.
 * See https://github.com/opengeo/gxp/raw/master/license.txt for the full text
 * of the license.
 */

/**
 * @requires plugins/LayerSource.js
 */

/**
 * The WMSCapabilities and WFSDescribeFeatureType formats parse the document and
 * pass the raw data to the WMSCapabilitiesReader/AttributeReader.  There,
 * records are created from layer data.  The rest of the data is lost.  It
 * makes sense to store this raw data somewhere - either on the OpenLayers
 * format or the GeoExt reader.  Until there is a better solution, we'll
 * override the reader's readRecords method  here so that we can have access to
 * the raw data later.
 * 
 * The purpose of all of this is to get the service title, feature type and
 * namespace later.
 * TODO: push this to OpenLayers or GeoExt
 */
(function() {
    function keepRaw(data) {
        var format = this.meta.format;
        if (typeof data === "string" || data.nodeType) {
            data = format.read(data);
            // cache the data for the single read that readRecord does
            var origRead = format.read;
            format.read = function() {
                format.read = origRead;
                return data;
            };
        }
        // here is the new part
        this.raw = data;
    }
    Ext.intercept(GeoExt.data.WMSCapabilitiesReader.prototype, "readRecords", keepRaw);
    GeoExt.data.AttributeReader &&
        Ext.intercept(GeoExt.data.AttributeReader.prototype, "readRecords", keepRaw);
})();

/** api: (define)
 *  module = gxp.plugins
 *  class = WMSSource
 */

/** api: (extends)
 *  plugins/LayerSource.js
 */
Ext.namespace("gxp.plugins");

/** api: constructor
 *  .. class:: WMSSource(config)
 *
 *    Plugin for using WMS layers with :class:`gxp.Viewer` instances. The
 *    plugin issues a GetCapabilities request to create a store of the WMS's
 *    layers.
 */   
/** api: example
 *  Configuration in the  :class:`gxp.Viewer`:
 *
 *  .. code-block:: javascript
 *
 *    defaultSourceType: "gxp_wmssource",
 *    sources: {
 *        "opengeo": {
 *            url: "http://suite.opengeo.org/geoserver/wms"
 *        }
 *    }
 *
 *  A typical configuration for a layer from this source (in the ``layers``
 *  array of the viewer's ``map`` config option would look like this:
 *
 *  .. code-block:: javascript
 *
 *    {
 *        source: "opengeo",
 *        name: "world",
 *        group: "background"
 *    }
 *
 */
gxp.plugins.WMSSource = Ext.extend(gxp.plugins.LayerSource, {
    
    /** api: ptype = gxp_wmssource */
    ptype: "gxp_wmssource",
    
    /** api: config[url]
     *  ``String`` WMS service URL for this source
     */

    /** private: config[restUrl]
     *  ``String`` Optional URL for rest configuration endpoint.  Note that this
     *  property is being added for a specific GeoNode case and it may be 
     *  removed if an alternate solution is chosen (like a specific 
     *  GeoNodeSource).  This is used where the rest config endpoint cannot
     *  be derived from the source url (e.g. source url "/geoserver" and rest
     *  config url "/other_rest_proxy").
     */

    /** api: config[baseParams]
     *  ``Object`` Base parameters to use on the WMS GetCapabilities
     *  request.
     */
    baseParams: null,

    /** private: property[format]
     *  ``OpenLayers.Format`` Optional custom format to use on the 
     *  WMSCapabilitiesStore store instead of the default.
     */
    format: null,
    
    /** private: property[describeLayerStore]
     *  ``GeoExt.data.WMSDescribeLayerStore`` additional store of layer
     *  descriptions. Will only be available when the source is configured
     *  with ``describeLayers`` set to true.
     */
    describeLayerStore: null,
    
    /** private: property[describedLayers]
     */
    describedLayers: null,
    
    /** private: property[schemaCache]
     */
    schemaCache: null,
    
    /** private: property[ready]
     *  ``Boolean``
     */
    ready: false,
    
    /** api: config[version]
     *  ``String``
     *  If specified, the version string will be included in WMS GetCapabilities
     *  requests.  By default, no version is set.
     */
    
    /** api: config[forceLazy]
     *  ``Array`` If set to true, no GetCapabilities request will be sent and
     *  missing srs and bbox properties will be replaced with the map
     *  projection and maxExtent. Not all plugins will work with layers from
     *  a source configured with ``forceLazy`` set to true.
     */

    /** private: method[constructor]
     */
    constructor: function(config) {
        gxp.plugins.WMSSource.superclass.constructor.apply(this, arguments);
        if (!this.format) {
            this.format = new OpenLayers.Format.WMSCapabilities({keepData: true});
        }
    },

    /** api: method[init]
     *  :arg target: ``Object`` The object initializing this plugin.
     */
    init: function(target) {
        gxp.plugins.WMSSource.superclass.init.apply(this, arguments);
        this.target.on("authorizationchange", this.onAuthorizationChange, this);
    },

    /** private: method[onAuthorizationChange]
     *  Reload the store when the authorization changes.
     */
    onAuthorizationChange: function() {
        if (this.store && this.store.url.charAt(0) === "/") {
            this.store.reload();
        }
    },

    /** private: method[destroy]
     */
    destroy: function() {
        this.target.un("authorizationchange", this.onAuthorizationChange, this);
        gxp.plugins.WMSSource.superclass.destroy.apply(this, arguments);
    },

    /** private: method[isLazy]
     *  :returns: ``Boolean``
     *
     *  The store for a lazy source will not be loaded upon creation.  A source
     *  determines whether or not it is lazy given the configured layers for
     *  the target.  If the layer configs have all the information needed to 
     *  construct layer records, the source can be lazy.
     */
    isLazy: function() {
        // TODO: complete the lazy implementation
        var lazy = false;
        var mapConfig = this.target.initialConfig.map;
        if (mapConfig && mapConfig.layers) {
            var layerConfig;
            for (var i=0, ii=mapConfig.layers.length; i<ii; ++i) {
                layerConfig = mapConfig.layers[i];
                if (layerConfig.source === this.id) {
                    lazy = this.layerConfigComplete(layerConfig);
                    if (lazy === false) {
                        break;
                    }
                }
            }
        }
        return lazy;
    },
    
    layerConfigComplete: function(config) {
        // for now, we assume that the layer config is incomplete, unless
        // forceLazy is set to true
        return config.forceLazy === true || this.forceLazy === true;
    },

    /** api: method[createStore]
     *
     *  Creates a store of layer records.  Fires "ready" when store is loaded.
     */
    createStore: function() {
        var baseParams = this.baseParams || {
            SERVICE: "WMS",
            REQUEST: "GetCapabilities"
        };
        if (this.version) {
            baseParams.VERSION = this.version;
        }

        var lazy = this.isLazy();
        
        this.store = new GeoExt.data.WMSCapabilitiesStore({
            // Since we want our parameters (e.g. VERSION) to override any in the 
            // given URL, we need to remove corresponding paramters from the 
            // provided URL.  Simply setting baseParams on the store is also not
            // enough because Ext just tacks these parameters on to the URL - so
            // we get requests like ?Request=GetCapabilities&REQUEST=GetCapabilities
            // (assuming the user provides a URL with a Request parameter in it).
            url: this.trimUrl(this.url, baseParams),
            baseParams: baseParams,
            format: this.format,
            autoLoad: !lazy,
            layerParams: {exceptions: null},
            listeners: {
                load: function() {
                    // The load event is fired even if a bogus capabilities doc 
                    // is read (http://trac.geoext.org/ticket/295).
                    // Until this changes, we duck type a bad capabilities 
                    // object and fire failure if found.
                    if (!this.store.reader.raw || !this.store.reader.raw.service) {
                        this.fireEvent("failure", this, "Invalid capabilities document.");
                    } else {
                        if (!this.title) {
                            this.title = this.store.reader.raw.service.title;                        
                        }
                        if (!this.ready) {
                            this.ready = true;
                            this.fireEvent("ready", this);
                        }
                    }
                    // clean up data stored on format after parsing is complete
                    delete this.format.data;
                },
                exception: function(proxy, type, action, options, response, error) {
                    delete this.store;
                    var msg, details = "";
                    if (type === "response") {
                        if (typeof error == "string") {
                            msg = error;
                        } else {
                            msg = "Invalid response from server.";
                            // special error handling in IE
                            var data = this.format && this.format.data;
                            if (data && data.parseError) {
                                msg += "  " + data.parseError.reason + " - line: " + data.parseError.line;
                            }
                            var status = response.status;
                            if (status >= 200 && status < 300) {
                                // TODO: consider pushing this into GeoExt
                                var report = error && error.arg && error.arg.exceptionReport;
                                details = gxp.util.getOGCExceptionText(report);
                            } else {
                                details = "Status: " + status;
                            }
                        }
                    } else {
                        msg = "Trouble creating layer store from response.";
                        details = "Unable to handle response.";
                    }
                    // TODO: decide on signature for failure listeners
                    this.fireEvent("failure", this, msg, details);
                    // clean up data stored on format after parsing is complete
                    delete this.format.data;
                },
                scope: this
            }
        });
        if (lazy) {
            // lazy sources are "immediately" ready - in the next turn
            window.setTimeout((function() {
                this.fireEvent("ready", this);
            }).createDelegate(this), 0);
        }
    },
    
    /** private: method[trimUrl]
     *  :arg url: ``String``
     *  :arg params: ``Object``
     *
     *  Remove all parameters from the URL's query string that have matching
     *  keys in the provided object.  Keys are compared in a case-insensitive 
     *  way.
     */
    trimUrl: function(url, params, respectCase) {
        var urlParams = OpenLayers.Util.getParameters(url);
        params = OpenLayers.Util.upperCaseObject(params);
        var keys = 0;
        for (var key in urlParams) {
            ++keys;
            if (key.toUpperCase() in params) {
                --keys;
                delete urlParams[key];
            }
        }
        return url.split("?").shift() + (keys ? 
            "?" + OpenLayers.Util.getParameterString(urlParams) :
            ""
        );
    },
    
    /** private: method[createLazyLayerRecord]
     *  :arg config: ``Object`` The application config for this layer.
     *  :returns: ``GeoExt.data.LayerRecord``
     *
     *  Create a minimal layer record
     */
    createLazyLayerRecord: function(config) {
        var record = new this.store.recordType(config);
        record.setLayer(new OpenLayers.Layer.WMS(
            config.title || config.name,
            this.url, 
            {layers: config.name}
        ));
        if (!config.srs) {
            // assume the map projection if none was configured
            var srs = {};
            srs[this.target.map.projection] = true;
            record.set("srs", srs);
        }
        if (!config.bbox) {
            var bbox = {};
            bbox[this.target.map.projection] = {
                bbox: this.target.map.maxExtent
            };
            record.set("bbox", bbox);
        }
        return record;
    },
     
    /** api: method[createLayerRecord]
     *  :arg config:  ``Object``  The application config for this layer.
     *  :returns: ``GeoExt.data.LayerRecord``
     *
     *  Create a layer record given the config.
     */
    createLayerRecord: function(config) {
        var record, original;
        var index = this.store.findExact("name", config.name);
        if (index > -1) {
            original = this.store.getAt(index);
        } else if (this.layerConfigComplete(config)) {
            original = this.createLazyLayerRecord(config);
        }
        if (original) {

            var layer = original.getLayer();

            /**
             * TODO: The WMSCapabilitiesReader should allow for creation
             * of layers in different SRS.
             */
            var projection = this.getMapProjection();
            
            // If the layer is not available in the map projection, find a
            // compatible projection that equals the map projection. This helps
            // us in dealing with the different EPSG codes for web mercator.
            var layerProjection = this.getProjection(original);

            var projCode = projection.getCode();
            var nativeExtent = original.get("bbox")[projCode];
            var swapAxis = layer.params.VERSION >= "1.3" && !!layer.yx[projCode];
            var maxExtent = 
                (nativeExtent && OpenLayers.Bounds.fromArray(nativeExtent.bbox, swapAxis)) || 
                OpenLayers.Bounds.fromArray(original.get("llbbox")).transform(new OpenLayers.Projection("EPSG:4326"), projection);
            
            // make sure maxExtent is valid (transform does not succeed for all llbbox)
            if (!(1 / maxExtent.getHeight() > 0) || !(1 / maxExtent.getWidth() > 0)) {
                // maxExtent has infinite or non-numeric width or height
                // in this case, the map maxExtent must be specified in the config
                maxExtent = undefined;
            }
            
            // use all params from original
            var params = Ext.applyIf({
                STYLES: config.styles,
                FORMAT: config.format,
                TRANSPARENT: config.transparent
            }, layer.params);
            
            var singleTile = false;
            if ("tiled" in config) {
                singleTile = !config.tiled;
            } else {
                // for now, if layer has a time dimension, use single tile
                if (original.data.dimensions && original.data.dimensions.time) {
                    singleTile = true;
                }
            }

            layer = new OpenLayers.Layer.WMS(
                config.title || layer.name, 
                layer.url, 
                params, {
                    attribution: layer.attribution,
                    maxExtent: maxExtent,
                    restrictedExtent: maxExtent,
                    singleTile: singleTile,
                    ratio: config.ratio || 1,
                    visibility: ("visibility" in config) ? config.visibility : true,
                    opacity: ("opacity" in config) ? config.opacity : 1,
                    buffer: ("buffer" in config) ? config.buffer : 1,
                    projection: layerProjection,
                    dimensions: original.data.dimensions
                }
            );
            
            // data for the new record
            var data = Ext.applyIf({
                title: layer.name,
                group: config.group,
                infoFormat: config.infoFormat,
                source: config.source,
                properties: "gxp_wmslayerpanel",
                fixed: config.fixed,
                selected: "selected" in config ? config.selected : false,
                restUrl: this.restUrl,
                layer: layer
            }, original.data);
            
            // add additional fields
            var fields = [
                {name: "source", type: "string"}, 
                {name: "group", type: "string"},
                {name: "properties", type: "string"},
                {name: "fixed", type: "boolean"},
                {name: "selected", type: "boolean"},
                {name: "restUrl", type: "string"},
                {name: "infoFormat", type: "string"}
            ];
            original.fields.each(function(field) {
                fields.push(field);
            });

            var Record = GeoExt.data.LayerRecord.create(fields);
            record = new Record(data, layer.id);

        }
        
        return record;
    },
    
    /** api: method[getProjection]
     *  :arg layerRecord: ``GeoExt.data.LayerRecord`` a record from this
     *      source's store
     *  :returns: ``OpenLayers.Projection`` A suitable projection for the
     *      ``layerRecord``. If the layer is available in the map projection,
     *      the map projection will be returned. Otherwise an equal projection,
     *      or null if none is available.
     *
     *  Get the projection that the source will use for the layer created in
     *  ``createLayerRecord``. If the layer is not available in a projection
     *  that fits the map projection, null will be returned.
     */
    getProjection: function(layerRecord) {
        var projection = this.getMapProjection();
        var compatibleProjection = projection;
        var availableSRS = layerRecord.get("srs");
        if (!availableSRS[projection.getCode()]) {
            compatibleProjection = null;
            var p, srs;
            for (srs in availableSRS) {
                if ((p=new OpenLayers.Projection(srs)).equals(projection)) {
                    compatibleProjection = p;
                    break;
                }
            }
        }
        return compatibleProjection;
    },
    
    /** private: method[initDescribeLayerStore]
     *  creates a WMSDescribeLayer store for layer descriptions of all layers
     *  created from this source.
     */
    initDescribeLayerStore: function() {
        var req = this.store.reader.raw.capability.request.describelayer;
        if (req) {
            var version = this.store.reader.raw.version;
            if (parseFloat(version) > 1.1) {
                //TODO don't force 1.1.1, fall back instead
                version = "1.1.1";
            }
            var params = {
                SERVICE: "WMS",
                VERSION: version,
                REQUEST: "DescribeLayer"
            };
            this.describeLayerStore = new GeoExt.data.WMSDescribeLayerStore({
                url: this.trimUrl(req.href, params),
                baseParams: params
            });
        }
    },
    
    /** api: method[describeLayer]
     *  :arg rec: ``GeoExt.data.LayerRecord`` the layer to issue a WMS
     *      DescribeLayer request for
     *  :arg callback: ``Function`` Callback function. Will be called with
     *      an ``Ext.data.Record`` from a ``GeoExt.data.DescribeLayerStore``
     *      as first argument, or false if the WMS does not support
     *      DescribeLayer.
     *  :arg scope: ``Object`` Optional scope for the callback.
     *
     *  Get a DescribeLayer response from this source's WMS.
     */
    describeLayer: function(rec, callback, scope) {
        if (!this.describeLayerStore) {
            this.initDescribeLayerStore();
        }
        function delayedCallback(arg) {
            window.setTimeout(function() {
                callback.call(scope, arg);
            }, 0);
        }
        if (!this.describeLayerStore) {
            delayedCallback(false);
            return;
        }
        if (!this.describedLayers) {
            this.describedLayers = {};
        }
        var layerName = rec.getLayer().params.LAYERS;
        var cb = function() {
            var recs = Ext.isArray(arguments[1]) ? arguments[1] : arguments[0];
            var rec, name;
            for (var i=recs.length-1; i>=0; i--) {
                rec = recs[i];
                name = rec.get("layerName");
                if (name == layerName) {
                    this.describeLayerStore.un("load", arguments.callee, this);
                    this.describedLayers[name] = true;
                    callback.call(scope, rec);
                    return;
                } else if (typeof this.describedLayers[name] == "function") {
                    var fn = this.describedLayers[name];
                    this.describeLayerStore.un("load", fn, this);
                    fn.apply(this, arguments);
                }
            }
            // something went wrong (e.g. GeoServer does not return a valid
            // DescribeFeatureType document for group layers)
            delete describedLayers[layerName];
            callback.call(scope, false);
        };
        var describedLayers = this.describedLayers;
        var index;
        if (!describedLayers[layerName]) {
            describedLayers[layerName] = cb;
            this.describeLayerStore.load({
                params: {LAYERS: layerName},
                add: true,
                callback: cb,
                scope: this
            });
        } else if ((index = this.describeLayerStore.findExact("layerName", layerName)) == -1) {
            this.describeLayerStore.on("load", cb, this);
        } else {
            delayedCallback(this.describeLayerStore.getAt(index));
        }
    },

    /** private: method[fetchSchema]
     *  :arg url: ``String`` The url fo the WFS endpoint
     *  :arg typeName: ``String`` The typeName to use
     *  :arg callback: ``Function`` Callback function. Will be called with
     *      a ``GeoExt.data.AttributeStore`` containing the schema as first
     *      argument, or false if the WMS does not support DescribeLayer or the
     *      layer is not associated with a WFS feature type.
     *  :arg scope: ``Object`` Optional scope for the callback.
     *
     *  Helper function to fetch the schema for a layer of this source.
     */
    fetchSchema: function(url, typeName, callback, scope) {
        var schema = this.schemaCache[typeName];
        if (schema) {
            if (schema.getCount() == 0) {
                schema.on("load", function() {
                    callback.call(scope, schema);
                }, this, {single: true});
            } else {
                callback.call(scope, schema);
            }
        } else {
            schema = new GeoExt.data.AttributeStore({
                url: url,
                baseParams: {
                    SERVICE: "WFS",
                    //TODO should get version from WFS GetCapabilities
                    VERSION: "1.1.0",
                    REQUEST: "DescribeFeatureType",
                    TYPENAME: typeName
                },
                autoLoad: true,
                listeners: {
                    "load": function() {
                        callback.call(scope, schema);
                    },
                    scope: this
                }
            });
            this.schemaCache[typeName] = schema;
        }
    },
    
    /** api: method[getSchema]
     *  :arg rec: ``GeoExt.data.LayerRecord`` the WMS layer to issue a WFS
     *      DescribeFeatureType request for
     *  :arg callback: ``Function`` Callback function. Will be called with
     *      a ``GeoExt.data.AttributeStore`` containing the schema as first
     *      argument, or false if the WMS does not support DescribeLayer or the
     *      layer is not associated with a WFS feature type.
     *  :arg scope: ``Object`` Optional scope for the callback.
     *
     *  Gets the schema for a layer of this source, if the layer is a feature
     *  layer.
     */
    getSchema: function(rec, callback, scope) {
        if (!this.schemaCache) {
            this.schemaCache = {};
        }
        if (rec.get('forceLazy') === true) {
            // when lazy, we have the following assumptions:
            // 1. URL of the WFS is the same as the URL of the WMS
            // 2. typeName is the same as the WMS Layer name
            this.fetchSchema(this.url, rec.get('name'), callback, scope);
        } else {
            this.describeLayer(rec, function(r) {
                if (r && r.get("owsType") == "WFS") {
                    var typeName = r.get("typeName");
                    var url = r.get("owsURL");
                    this.fetchSchema(url, typeName, callback, scope);
                } else {
                    callback.call(scope, false);
                }
            }, this);
        }
    },
    
    /** api: method[getWFSProtocol]
     *  :arg record: :class:`GeoExt.data.LayerRecord`
     *  :arg callback: ``Function``
     *  :arg scope: ``Object``
     *  :returns: :class:`OpenLayers.Protocol.WFS`
     *
     *  Creates a WFS protocol for the given WMS layer record.
     */
    getWFSProtocol: function(record, callback, scope) {
        this.getSchema(record, function(schema) {
            var protocol = false;
            if (schema) {
                var geometryName;
                var geomRegex = /gml:((Multi)?(Point|Line|Polygon|Curve|Surface|Geometry)).*/;
                schema.each(function(r) {
                    var match = geomRegex.exec(r.get("type"));
                    if (match) {
                        geometryName = r.get("name");
                    }
                }, this);
                protocol = new OpenLayers.Protocol.WFS({
                    version: "1.1.0",
                    srsName: record.getLayer().projection.getCode(),
                    url: schema.url,
                    featureType: schema.reader.raw.featureTypes[0].typeName,
                    featureNS: schema.reader.raw.targetNamespace,
                    geometryName: geometryName
                });
            }
            callback.call(scope, protocol, schema, record);
        }, this);
    },

    /** api: method[getConfigForRecord]
     *  :arg record: :class:`GeoExt.data.LayerRecord`
     *  :returns: ``Object``
     *
     *  Create a config object that can be used to recreate the given record.
     */
    getConfigForRecord: function(record) {
        var config = gxp.plugins.WMSSource.superclass.getConfigForRecord.apply(this, arguments);
        var layer = record.getLayer();
        var params = layer.params;
        return Ext.apply(config, {
            format: params.FORMAT,
            styles: params.STYLES,
            transparent: params.TRANSPARENT
        });
    }
    
});

Ext.preg(gxp.plugins.WMSSource.prototype.ptype, gxp.plugins.WMSSource);
