/*
    Pioneer AVR TV Accessory Module for homebridge
*/
const PioneerAvr = require('./pioneer-avr');
const ppath = require('persist-path');
const fs = require('fs');
const mkdirp = require('mkdirp');

let Service;
let Characteristic;

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory("homebridge-pioneer-avr", "pioneerAvrAccessory", pioneerAvrAccessory);
};

function pioneerAvrAccessory(log, config) {
    // Main accessory initialization
    this.log = log;
    this.name = config.name;
    this.host = config.host;
    this.port = config.port;
    this.model = config.model || "VSX-1120K";
    this.prefsDir = config.prefsDir || ppath('pioneerAvr/');

    log.debug('Preferences directory : %s', this.prefsDir);
    this.manufacturer = "Pioneer";
    this.version = "0.8.1";

    // check if prefs directory ends with a /, if not then add it
    if (this.prefsDir.endsWith('/') === false) {
        this.prefsDir = this.prefsDir + '/';
    }

    // check if the preferences directory exists, if not then create it
    if (fs.existsSync(this.prefsDir) === false) {
        mkdirp(this.prefsDir);
    }

    this.inputVisibilityFile = this.prefsDir + 'inputsVisibility_' + this.host;
    this.savedVisibility = {};
    try {
        this.savedVisibility = JSON.parse(fs.readFileSync(this.inputVisibilityFile));
    } catch (err) {
        this.log.debug('Input visibility file does not exist');
    }

    this.avr = new PioneerAvr(this.log, this.host, this.port);
    this.enabledServices = [];

    this.prepareInformationService();
    this.prepareTvService();
    this.prepareInputSourceService();
}

pioneerAvrAccessory.prototype.prepareInformationService = function() {
    // Set accessory information
    this.informationService = new Service.AccessoryInformation();
    this.informationService
        .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
        .setCharacteristic(Characteristic.Model, this.model)
        .setCharacteristic(Characteristic.SerialNumber, this.host)
        .setCharacteristic(Characteristic.FirmwareRevision, this.version);

    this.enabledServices.push(this.informationService);
};

pioneerAvrAccessory.prototype.prepareTvService = function () {
    // Create TV service for homekit
    const me = this;

    this.tvService = new Service.Television(this.name, 'tvService');
    this.tvService
        .setCharacteristic(Characteristic.ConfiguredName, this.name);
    this.tvService
        .setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    // Set Active charateristic to power on or off AVR
    this.tvService
        .getCharacteristic(Characteristic.Active)
        .on('get', this.getPowerOn.bind(this))
        .on('set', this.setPowerOn.bind(this));

    // ActiveIdentifier show and set current input on TV badge in homekit
    this.tvService
        .getCharacteristic(Characteristic.ActiveIdentifier)
        .on('get', this.getActiveIdentifier.bind(this))
        .on('set', this.setActiveIdentifier.bind(this));

    this.enabledServices.push(this.tvService);
};

pioneerAvrAccessory.prototype.prepareInputSourceService = function () {
    // Run avr.loadInputs with addInputSourceService callback to create each input service
    this.log.info('Discovering inputs');
    this.avr.loadInputs(this.addInputSourceService.bind(this));
};

pioneerAvrAccessory.prototype.addInputSourceService = function(key) {
    // Create an input service from the information in avr.inputs
    const me = this;

    this.log.info('Add input n°%s - Name: %s Id: %s Type: %s',
        key, this.avr.inputs[key].name,
        this.avr.inputs[key].id,
        this.avr.inputs[key].type
        );

    let savedInputVisibility;
    if (this.avr.inputs[key].id in this.savedVisibility) {
        savedInputVisibility = this.savedVisibility[this.avr.inputs[key].id];
    } else {
        savedInputVisibility = Characteristic.CurrentVisibilityState.SHOWN;
    }
    let tmpInput = new Service.InputSource(this.avr.inputs[key].name, 'tvInputService' + key);
    tmpInput
        .setCharacteristic(Characteristic.Identifier, key)
        .setCharacteristic(Characteristic.ConfiguredName, this.avr.inputs[key].name) // Name in home app
        .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(Characteristic.InputSourceType, this.avr.inputs[key].type)
        .setCharacteristic(Characteristic.CurrentVisibilityState, savedInputVisibility) // Show in input list
        .setCharacteristic(Characteristic.TargetVisibilityState, savedInputVisibility); // Enable show selection
    tmpInput
        .getCharacteristic(Characteristic.TargetVisibilityState)
        .on('set', (state, callback) => {
            me.log.debug('Set %s TargetVisibilityState %s', me.avr.inputs[key].name, state);
            me.savedVisibility[me.avr.inputs[key].id] = state;
            fs.writeFile(me.inputVisibilityFile, JSON.stringify(me.savedVisibility), (err) => {
                if (err) {
                    me.log.debug('Error : Could not write input visibility %s', err);
                } else {
                    me.log.debug('Input visibility successfully saved');
                }
            });
            tmpInput.setCharacteristic(Characteristic.CurrentVisibilityState, state);
            callback();
        });
    tmpInput
        .getCharacteristic(Characteristic.ConfiguredName)
        .on('set', (name, callback) => { // Rename input
            me.log.info('Rename input %s to %s', me.avr.inputs[key].name, name);
            me.avr.inputs[key].name = name.substring(0,14);
            me.avr.renameInput(me.avr.inputs[key].id, name);
            callback();
        });

    this.tvService.addLinkedService(tmpInput);
    this.enabledServices.push(tmpInput);
};

// Callback methods
// Callbacks for InformationService
pioneerAvrAccessory.prototype.getPowerOn = function (callback) {
    // Get AVR's power status
    this.log.info('Get power status');
    this.avr.powerStatus(callback);
};

pioneerAvrAccessory.prototype.setPowerOn = function (on, callback) {
    // Set power on/off
    if (on) {
        this.log.info('Power on');
        this.avr.powerOn();
    } else {
        this.log.info('Power off');
        this.avr.powerOff();
    }

    callback();
};

pioneerAvrAccessory.prototype.getActiveIdentifier = function (callback) {
    // Update current input
    this.log.info('Get input status');
    this.avr.inputStatus(callback);
};

pioneerAvrAccessory.prototype.setActiveIdentifier = function(newValue, callback) {
    // Change input
    this.log.info('set active identifier %s:%s ', newValue, this.avr.inputs[newValue].id);
    this.avr.setInput(this.avr.inputs[newValue].id);

    callback();
};

pioneerAvrAccessory.prototype.getServices = function() {
    // This method is called once on startup. We need to wait for accessory to be ready
    // i.e., all inputs are created
    while (this.avr.isReady == false) {
        require('deasync').sleep(500);
        this.log.debug('Waiting for pioneerAvrAccessory to be ready');
    }

    this.log.info('Accessory %s ready', this.name);
    this.log.debug('Enabled services : %s', this.enabledServices.length);

    return this.enabledServices;
};
