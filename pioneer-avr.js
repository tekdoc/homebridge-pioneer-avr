/*
    Helper module for controlling Pioneer AVR
*/

const request = require('request');
const TelnetAvr = require('./telnet-avr');

// Reference for input id -> Characteristic.InputSourceType
const inputToType = {
        '22': 3, // HDMI4 -> Characteristic.InputSourceType.HDMI
        '25': 3, // BD -> Characteristic.InputSourceType.HDMI
        '26': 10, // NET RADIO -> Characteristic.InputSourceType.APPLICATION
};

function PioneerAvr(log, host, port) {
    const me = this;
    this.log = log;
    this.host = host;
    this.port = port;

    // Current AV status
    this.state = {
        volume: null,
        on: null,
        muted: null,
        input: null
    };

    // Inputs' list
    this.inputs = [];

    // Web interface ?
    this.web = false;
    this.webStatusUrl = 'http://' + this.host + '/StatusHandler.asp';
    this.webEventHandlerBaseUrl = 'http://' + this.host + '/EventHandler.asp?WebToHostItem=';
    request
        .get(this.webStatusUrl)
        .on('response', function(response) {
            if (response.statusCode == '200') {
                me.log.info('Web Interface enabled');
                this.web = true;
            }
        });

    // Communication Initialization
    this.s = new TelnetAvr(this.host, this.port);

    // Dealing with input's initialization
    this.initCount = 0;
    this.isReady = false;
}
module.exports = PioneerAvr;

PioneerAvr.prototype.loadInputs = function(callback) {
    // Queue and send all inputs discovery commands
    this.log.debug('Discovering inputs');
    for (var key in inputToType) {
        this.log.debug('Trying Input key: %s', key);
        this.sendCommand(`?RGB${key}`, callback);
    }
};

// Power methods

PioneerAvr.prototype.__updatePower = function(callback) {
    this.sendCommand('?P', callback);
};

PioneerAvr.prototype.powerStatus = function(callback) {
    require('deasync').sleep(100);
    this.__updatePower(() => {
        callback(null, this.state.on);
    });
};

PioneerAvr.prototype.powerOn = function() {
    this.log.debug('Power on');

    if (this.web) {
        request.get(this.webEventHandlerBaseUrl + 'PO');
    } else {
        this.sendCommand('PO');
    }
};

PioneerAvr.prototype.powerOff = function() {
    this.log.debug('Power off');
    if (this.web) {
        request.get(this.webEventHandlerBaseUrl + 'PF');
    } else {
        this.sendCommand('PF');
    }
};

// Input management method

PioneerAvr.prototype.__updateInput = function(callback) {
    this.sendCommand('?F', callback);
};

PioneerAvr.prototype.inputStatus = function(callback) {
    this.__updateInput(() => {
        callback(null, this.state.input);
    });
};

PioneerAvr.prototype.setInput = function(id) {
    if (this.web) {
        request.get(this.webEventHandlerBaseUrl + `${id}FN`);
    } else {
        this.sendCommand(`${id}FN`);
    }
};

PioneerAvr.prototype.renameInput = function (id, newName) {
    let shrinkName = newName.substring(0,14);
    this.sendCommand(`${shrinkName}1RGB${id}`);
};

// Send command and process return

PioneerAvr.prototype.sendCommand = async function(command, callback) {
    // Main method to send a command to AVR
    try {
        this.log.debug('Send command : %s', command);
        data = await this.s.sendMessage(command);
        this.log.debug('Receive data : %s', data);
    } catch (e) {
        this.log.error(e)
    }

    // Data returned for power status
    if (data.startsWith('PWR')) {
        this.log.debug('Receive Power status : %s', data);
        this.state.on = parseInt(data[3], 10) === 0;
        callback();
    }

    // Data returned for input status
    if (data.startsWith('FN')) {
        this.log.debug('Receive Input status : %s', data);
        let inputId = data.substr(2);
        let inputIndex = null;
        for (var x in this.inputs) {
            if (this.inputs[x].id == inputId) {
                inputIndex = x;
            }
        }
        this.state.input = inputIndex;
        callback();
    }

    // Data returned for input queries
    if (data.startsWith('RGB')) {
        let tmpInput = {
            id: data.substr(3,2),
            name: data.substr(6).trim(),
            type: inputToType[data.substr(3,2)]
            };
        this.inputs.push(tmpInput);
        if (!this.isReady) {
            this.initCount = this.initCount + 1;
            this.log.debug('Input [%s] discovered (id: %s, type: %s). InitCount=%s/%s',
                tmpInput.name,
                tmpInput.id,
                tmpInput.type,
                this.initCount,
                Object.keys(inputToType).length
                );
            if (this.initCount == Object.keys(inputToType).length) this.isReady = true;
        }
        callback(this.inputs.length-1);
    }

    // E06 is returned when input does not exist
    if (data.startsWith('E06')) {
        this.log.debug('Receive E06 error');
        if (!this.isReady) {
            this.initCount = this.initCount + 1;
            this.log.debug('Input does not exists. InitCount=%s/%s',
                this.initCount,
                Object.keys(inputToType).length
                );
            if (this.initCount == Object.keys(inputToType).length) this.isReady = true;
        }
    }
};

