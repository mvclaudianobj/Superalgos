function newPlottersManager() {
    const MODULE_NAME = 'Plotters Manager'
    const ERROR_LOG = true
    const logger = newWebDebugLog()
    logger.fileName = MODULE_NAME

    let timeFrame = INITIAL_TIME_PERIOD
    let datetime = NEW_SESSION_INITIAL_DATE

    let thisObject = {
        fitFunction: undefined,
        container: undefined,
        payload: undefined,
        connectors: [],
        setDatetime: setDatetime,
        setTimeFrame: setTimeFrame,
        setCoordinateSystem: setCoordinateSystem,
        draw: draw,
        getContainer: getContainer,
        initialize: initialize,
        finalize: finalize
    }

    thisObject.connectors = []

    let initializationReady = false
    let layersPanel
    let onLayerStatusChangedEventSuscriptionId
    let coordinateSystem

    setupContainer()
    return thisObject

    function setupContainer() {
        thisObject.container = newContainer()
        thisObject.container.initialize(MODULE_NAME)
    }

    function finalize() {
        layersPanel.container.eventHandler.stopListening(onLayerStatusChangedEventSuscriptionId)
        layersPanel = undefined

        for (let i = 0; i < thisObject.connectors.length; i++) {
            let connector = thisObject.connectors[i]
            /* Then the panels. */
            for (let j = 0; j < connector.panels.length; j++) {
                canvas.panelsSpace.destroyPanel(connector.panels[j])
                connector.panels[j] = undefined
            }
            connector.panels = undefined

            /* Finalize the plotters */
            if (connector.plotter.finalize !== undefined) {
                connector.plotter.container.eventHandler.stopListening(connector.plotter.onRecordChangeEventsSubscriptionId)
                connector.plotter.finalize()
            }
            connector.plotter = undefined

            /* Finally the Storage Objects */
            finalizeStorage(connector.storage)
            connector.storage = undefined

            connector = undefined
        }
        thisObject.connectors = []
        coordinateSystem = undefined

        thisObject.container.finalize()
        thisObject.container = undefined
        thisObject.payload = undefined
    }

    function finalizeStorage(storage) {
        storage.eventHandler.stopListening(storage.onMarketFileLoadedLayerEventsSubscriptionId)
        storage.eventHandler.stopListening(storage.onDailyFileLoadedLayerEventsSubscriptionId)
        storage.eventHandler.stopListening(storage.onSingleFileLoadedLayerEventsSubscriptionId)
        storage.eventHandler.stopListening(storage.onFileSequenceLoadedLayerEventsSubscriptionId)
        storage.eventHandler.stopListening(storage.onDailyFileLoadedPlotterEventsSubscriptionId)
        storage.finalize()
    }

    function initialize(pLayersPanel) {
        /* Remember this */
        layersPanel = pLayersPanel

        /* Listen to the event of change of status */
        onLayerStatusChangedEventSuscriptionId = layersPanel.container.eventHandler.listenToEvent('Layer Status Changed', onLayerStatusChanged)
    }

    function initializePlotter(layer) {
        try {
            /* Before Initializing a Plotter, we need the Storage it will use, loaded with the files it will initially need. */
            let storage = newProductStorage(layer.payload.node.id)

            /*
            Before Initializing the Storage, we will put the Layer to listen to the events the storage will raise every time a file is loaded,
            so that the UI can somehow show this. There are different types of events.
            */
            for (let i = 0; i < layer.definition.referenceParent.referenceParent.datasets.length; i++) {
                let dataset = layer.definition.referenceParent.referenceParent.datasets[i]

                switch (dataset.config.type) {
                    case 'Market Files': {
                        storage.onMarketFileLoadedLayerEventsSubscriptionId = storage.eventHandler.listenToEvent('Market File Loaded', layer.onMarketFileLoaded)
                    }
                        break
                    case 'Daily Files': {
                        storage.onDailyFileLoadedLayerEventsSubscriptionId = storage.eventHandler.listenToEvent('Daily File Loaded', layer.onDailyFileLoaded)
                    }
                        break
                    case 'Single File': {
                        storage.onSingleFileLoadedLayerEventsSubscriptionId = storage.eventHandler.listenToEvent('Single File Loaded', layer.onSingleFileLoaded)
                    }
                        break
                    case 'File Sequence': {
                        storage.onFileSequenceLoadedLayerEventsSubscriptionId = storage.eventHandler.listenToEvent('File Sequence Loaded', layer.onFileSequenceLoaded)
                    }
                        break
                    default: {
                        if (ERROR_LOG === true) {
                            logger.write('[ERROR] initializePlotter -> Dataset Type Incorrect or Undefined -> dataset.type = ' + dataset.type)
                        }
                        return
                    }
                }
            }

            let baseAsset = layer.baseAsset.config.codeName
            let quotedAsset = layer.quotedAsset.config.codeName
            let market = {
                baseAsset: baseAsset,
                quotedAsset: quotedAsset
            }
            let productDefinition = layer.productDefinition
            let bot = layer.bot
            let dataMine = layer.dataMine
            let exchange = layer.exchange
            let plotterModule = layer.plotterModule
            let session
            let tradingSystem
            let tradingEngine

            /*
            A layer can be referencing a Data Product in two different branches of the Network hiriatchy.
            In one of those braches we can get the Session node, at the other we Cannot.
            */
            let sessionReference = findNodeInNodeMesh(layer.definition, 'Session Reference', undefined, false, true, true, true)

            if (sessionReference !== undefined) {
                session = sessionReference.referenceParent
                if (session === undefined) {
                    logger.write('[ERROR] initializePlotter -> Sessioin is Undefined at Session Reference -> Plotter will not be loaded. ')
                    return
                }
                /* From the session we might be able to reach the Trading System or the Trading Engine */
                if (session.tradingSystemReference !== undefined) {
                    tradingSystem = session.tradingSystemReference.referenceParent
                }
                if (session.tradingEngineReference !== undefined) {
                    tradingEngine = session.tradingEngineReference.referenceParent
                }
            }

            let host = layer.networkNode.config.host
            let webPort = layer.networkNode.config.webPort
            if (host === undefined) { host = window.location.hostname }
            if (webPort === undefined) { webPort = window.location.port }

            let eventsServerClient = canvas.designSpace.workspace.eventsServerClients.get(layer.networkNode.id)

            storage.initialize(
                dataMine,
                bot,
                session,
                productDefinition,
                exchange,
                market,
                datetime,
                timeFrame,
                host,
                webPort,
                eventsServerClient,
                onProductStorageInitialized
            )

            function onProductStorageInitialized(err) {
                if (err.result === GLOBAL.DEFAULT_OK_RESPONSE.result) {
                    /* Now we have all the initial data loaded and ready to be delivered to the new instance of the plotter. */
                    let plotter

                    if (plotterModule.config.isLegacy !== true) {
                        plotter = newPlotter()
                    } else {
                        plotter = getNewPlotter(dataMine.config.codeName, plotterModule.parentNode.config.codeName, plotterModule.config.codeName)
                    }

                    plotter.container.connectToParent(thisObject.container, true, true, false, true, true, true, false, false, true)
                    plotter.container.frame.position.x = thisObject.container.frame.width / 2 - plotter.container.frame.width / 2
                    plotter.container.frame.position.y = thisObject.container.frame.height / 2 - plotter.container.frame.height / 2
                    plotter.fitFunction = thisObject.fitFunction
                    plotter.initialize(storage, datetime, timeFrame, coordinateSystem, onPlotterInizialized, productDefinition)

                    function onPlotterInizialized() {
                        let connector = {
                            layer: layer,
                            plotter: plotter,
                            storage: storage
                        }
                        /* Let the Plotter listen to the event of Cursor Files loaded, so that it can react recalculating if needed. */
                        plotter.onDailyFileLoadedPlotterEventsSubscriptionId = storage.eventHandler.listenToEvent('Daily File Loaded', plotter.onDailyFileLoaded)
                        /* Lets load now this plotter panels. */
                        connector.panels = []

                        if (productDefinition !== undefined) {
                            /* Here we setup the panels associated with this plotter */
                            for (let i = 0; i < plotterModule.panels.length; i++) {
                                let panel = plotterModule.panels[i]

                                let parameters = {
                                    dataMine: dataMine.config.codeName,
                                    plotterCodeName: plotterModule.parentNode.config.codeName,
                                    moduleCodeName: plotterModule.config.codeName,
                                    panelNode: panel
                                }

                                let owner = thisObject.payload.node.payload.parentNode.id // Panels are owned by the time machine.
                                let plotterPanelHandle = canvas.panelsSpace.createNewPanel('Plotter Panel', parameters, owner, layer.session)
                                let plotterPanel = canvas.panelsSpace.getPanel(plotterPanelHandle)

                                /* Connect Panel to the Plotter via an Event. */
                                connector.plotter.onRecordChangeEventsSubscriptionId = connector.plotter.container.eventHandler.listenToEvent('Current Record Changed', plotterPanel.onRecordChange)
                                connector.panels.push(plotterPanelHandle)
                            }
                            connector.layer.panels = connector.panels

                            /*
                            Next we will check the different types of Plotting related to connecting to an existing node branch.
                            */
                            if (plotterModule.nodesHighlights !== undefined && plotterModule.config.connectTo !== undefined) {
                                connector.nodesHighlights = newNodesHighlights()
                                switch (plotterModule.config.connectTo) {
                                    case 'Trading System':
                                        connector.nodesHighlights.initialize(tradingSystem)
                                        break
                                    case 'Trading Engine':
                                        connector.nodesHighlights.initialize(tradingEngine)
                                        break
                                }
                                connector.nodesHighlights.onRecordChangeEventsSubscriptionId = connector.plotter.container.eventHandler.listenToEvent('Current Record Changed', connector.nodesHighlights.onRecordChange)
                            }
                            if (plotterModule.nodesValues !== undefined && plotterModule.config.connectTo !== undefined) {
                                connector.nodesValues = newNodesValues()
                                switch (plotterModule.config.connectTo) {
                                    case 'Trading System':
                                        connector.nodesValues.initialize(tradingSystem)
                                        break
                                    case 'Trading Engine':
                                        connector.nodesValues.initialize(tradingEngine)
                                        break
                                }
                                connector.nodesValues.onRecordChangeEventsSubscriptionId = connector.plotter.container.eventHandler.listenToEvent('Current Record Changed', connector.nodesValues.onRecordChange)
                            }
                            if (plotterModule.nodesErrors !== undefined && plotterModule.config.connectTo !== undefined) {
                                connector.nodesErrors = newNodesErrors()
                                switch (plotterModule.config.connectTo) {
                                    case 'Trading System':
                                        connector.nodesErrors.initialize(tradingSystem)
                                        break
                                    case 'Trading Engine':
                                        connector.nodesErrors.initialize(tradingEngine)
                                        break
                                }
                                connector.nodesErrors.onRecordChangeEventsSubscriptionId = connector.plotter.container.eventHandler.listenToEvent('Current Record Changed', connector.nodesErrors.onRecordChange)
                            }
                            if (plotterModule.nodesWarnings !== undefined && plotterModule.config.connectTo !== undefined) {
                                connector.nodesWarnings = newNodesWarnings()
                                switch (plotterModule.config.connectTo) {
                                    case 'Trading System':
                                        connector.nodesWarnings.initialize(tradingSystem)
                                        break
                                    case 'Trading Engine':
                                        connector.nodesWarnings.initialize(tradingEngine)
                                        break
                                }
                                connector.nodesWarnings.onRecordChangeEventsSubscriptionId = connector.plotter.container.eventHandler.listenToEvent('Current Record Changed', connector.nodesWarnings.onRecordChange)
                            }
                            if (plotterModule.nodesInfos !== undefined && plotterModule.config.connectTo !== undefined) {
                                connector.nodesInfos = newNodesInfos()
                                switch (plotterModule.config.connectTo) {
                                    case 'Trading System':
                                        connector.nodesInfos.initialize(tradingSystem)
                                        break
                                    case 'Trading Engine':
                                        connector.nodesInfos.initialize(tradingEngine)
                                        break
                                }
                                connector.nodesInfos.onRecordChangeEventsSubscriptionId = connector.plotter.container.eventHandler.listenToEvent('Current Record Changed', connector.nodesInfos.onRecordChange)
                            }
                            if (plotterModule.nodesRunning !== undefined && plotterModule.config.connectTo !== undefined) {
                                connector.nodesRunning = newNodesRunning()
                                switch (plotterModule.config.connectTo) {
                                    case 'Trading System':
                                        connector.nodesRunning.initialize(tradingSystem)
                                        break
                                    case 'Trading Engine':
                                        connector.nodesRunning.initialize(tradingEngine)
                                        break
                                }
                                connector.nodesRunning.onRecordChangeEventsSubscriptionId = connector.plotter.container.eventHandler.listenToEvent('Current Record Changed', connector.nodesRunning.onRecordChange)
                            }
                            if (plotterModule.nodesStatus !== undefined && plotterModule.config.connectTo !== undefined) {
                                connector.nodesStatus = newNodesStatus()
                                switch (plotterModule.config.connectTo) {
                                    case 'Trading System':
                                        connector.nodesStatus.initialize(tradingSystem)
                                        break
                                    case 'Trading Engine':
                                        connector.nodesStatus.initialize(tradingEngine)
                                        break
                                }
                                connector.nodesStatus.onRecordChangeEventsSubscriptionId = connector.plotter.container.eventHandler.listenToEvent('Current Record Changed', connector.nodesStatus.onRecordChange)
                            }
                            if (plotterModule.nodesProgress !== undefined && plotterModule.config.connectTo !== undefined) {
                                connector.nodesProgress = newNodesProgress()
                                switch (plotterModule.config.connectTo) {
                                    case 'Trading System':
                                        connector.nodesProgress.initialize(tradingSystem)
                                        break
                                    case 'Trading Engine':
                                        connector.nodesProgress.initialize(tradingEngine)
                                        break
                                }
                                connector.nodesProgress.onRecordChangeEventsSubscriptionId = connector.plotter.container.eventHandler.listenToEvent('Current Record Changed', connector.nodesProgress.onRecordChange)
                            }
                            if (plotterModule.nodesAnnouncements !== undefined && plotterModule.config.connectTo !== undefined) {
                                connector.nodesAnnounements = newNodesAnnouncements()
                                switch (plotterModule.config.connectTo) {
                                    case 'Trading System':
                                        connector.nodesAnnounements.initialize(tradingSystem)
                                        break
                                    case 'Trading Engine':
                                        connector.nodesAnnounements.initialize(tradingEngine)
                                        break
                                }
                                connector.nodesAnnounements.onRecordChangeEventsSubscriptionId = connector.plotter.container.eventHandler.listenToEvent('Current Record Changed', connector.nodesAnnounements.onRecordChange)
                            }
                            /*
                            Another type of plotting is with Record Values. This method uses the record definition to find the target node
                            and from there is looks into its children all based on the Record Definition configuration.
                            */
                            if (plotterModule.recordValues !== undefined) {
                                connector.recordValues = newRecordValues()
                                connector.recordValues.initialize(tradingSystem, tradingEngine, productDefinition)
                                connector.recordValues.onRecordChangeEventsSubscriptionId = connector.plotter.container.eventHandler.listenToEvent('Current Record Changed', connector.recordValues.onRecordChange)
                            }
                        }
                        thisObject.connectors.push(connector)
                    }
                }
            }
        } catch (err) {
            if (ERROR_LOG === true) { logger.write('[ERROR] initializePlotter -> err = ' + err.stack) }
        }
    }

    function onLayerStatusChanged(layer) {
        if (layer.status === LAYER_STATUS.LOADING) {
            /* Lets see if we can find the Plotter of this card on our Active Plotters list, other wise we will initialize it */
            let found = false
            for (let i = 0; i < thisObject.connectors.length; i++) {
                let connector = thisObject.connectors[i]
                if (connector.layer.payload.node.id === layer.payload.node.id) {
                    found = true
                }
            }
            if (found === false) {
                initializePlotter(layer)
            }
        }
        if (layer.status === LAYER_STATUS.OFF) {
            /* If the plotter of this card is not on our Active Plotters list, then we remove it. */
            for (let i = 0; i < thisObject.connectors.length; i++) {
                let connector = thisObject.connectors[i]
                if (connector.layer.payload.node.id === layer.payload.node.id) {
                    /* Then the panels. */
                    for (let j = 0; j < connector.panels.length; j++) {
                        canvas.panelsSpace.destroyPanel(connector.panels[j])
                    }
                    /* Finally the Storage Objects */
                    finalizeNodesPlotting(connector)
                    if (connector.plotter.finalize !== undefined) {
                        connector.plotter.container.eventHandler.stopListening(connector.plotter.onRecordChangeEventsSubscriptionId)
                        connector.plotter.container.finalize()
                        connector.plotter.finalize()
                    }
                    finalizeStorage(connector.storage)
                    thisObject.connectors.splice(i, 1) // Delete item from array.
                    return // We already found the product woth changes and processed it.
                }
            }
        }
    }

    function finalizeNodesPlotting(connector) {
        if (connector.nodesHighlights !== undefined) {
            connector.plotter.container.eventHandler.stopListening(connector.nodesHighlights.onRecordChangeEventsSubscriptionId)
            connector.nodesHighlights.finalize()
        }
        if (connector.nodesValues !== undefined) {
            connector.plotter.container.eventHandler.stopListening(connector.nodesValues.onRecordChangeEventsSubscriptionId)
            connector.nodesValues.finalize()
        }
        if (connector.nodesErrors !== undefined) {
            connector.plotter.container.eventHandler.stopListening(connector.nodesErrors.onRecordChangeEventsSubscriptionId)
            connector.nodesErrors.finalize()
        }
        if (connector.nodesWarnings !== undefined) {
            connector.plotter.container.eventHandler.stopListening(connector.nodesWarnings.onRecordChangeEventsSubscriptionId)
            connector.nodesWarnings.finalize()
        }
        if (connector.nodesInfos !== undefined) {
            connector.plotter.container.eventHandler.stopListening(connector.nodesInfos.onRecordChangeEventsSubscriptionId)
            connector.nodesInfos.finalize()
        }
        if (connector.nodesStatus !== undefined) {
            connector.plotter.container.eventHandler.stopListening(connector.nodesStatus.onRecordChangeEventsSubscriptionId)
            connector.nodesStatus.finalize()
        }
        if (connector.nodesProgress !== undefined) {
            connector.plotter.container.eventHandler.stopListening(connector.Progress.onRecordChangeEventsSubscriptionId)
            connector.Progress.finalize()
        }
        if (connector.nodesRunning !== undefined) {
            connector.plotter.container.eventHandler.stopListening(connector.nodesRunning.onRecordChangeEventsSubscriptionId)
            connector.nodesRunning.finalize()
        }
        if (connector.recordValues !== undefined) {
            connector.plotter.container.eventHandler.stopListening(connector.recordValues.onRecordChangeEventsSubscriptionId)
            connector.recordValues.finalize()
        }
    }

    function setTimeFrame(pTimeFrame) {
        timeFrame = pTimeFrame
        for (let i = 0; i < thisObject.connectors.length; i++) {
            let connector = thisObject.connectors[i]
            connector.layer.setTimeFrame(timeFrame)
            connector.storage.setTimeFrame(timeFrame)
            connector.plotter.setTimeFrame(timeFrame)
        }
    }

    function setDatetime(pDatetime) {
        datetime = pDatetime
        for (let i = 0; i < thisObject.connectors.length; i++) {
            let connector = thisObject.connectors[i]
            connector.layer.setDatetime(pDatetime)
            connector.storage.setDatetime(pDatetime)
            connector.plotter.setDatetime(pDatetime)
        }
    }

    function setCoordinateSystem(pCoordinateSystem) {
        coordinateSystem = pCoordinateSystem
        for (let i = 0; i < thisObject.connectors.length; i++) {
            let connector = thisObject.connectors[i]
            connector.plotter.setCoordinateSystem(coordinateSystem)
        }
    }

    function getContainer(point) {
    }

    function draw() {
        if (thisObject.connectors === undefined) { return } // We need to wait
        /* First the Product Plotters. */
        let maxElementsPlotted = 0
        for (let i = 0; i < thisObject.connectors.length; i++) {
            let connector = thisObject.connectors[thisObject.connectors.length - i - 1]
            let elementsPlotted = connector.plotter.draw()
            if (elementsPlotted !== undefined) {
                if (elementsPlotted > maxElementsPlotted) {
                    maxElementsPlotted = elementsPlotted
                }
            }
        }
        return maxElementsPlotted
    }
}
