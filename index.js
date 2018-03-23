var miio = require('miio');
var Accessory, Service, Characteristic, UUIDGen;


module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerAccessory('homebridge-xiaomi-roborock-vacuum', 'XiaomiRoborockVacuum', XiaomiRoborockVacuum);
}


function XiaomiRoborockVacuum(log, config) {
    var that = this;

    that.services = [];
    that.log = log;
    that.name = config.name || 'Roborock vacuum cleaner';
    that.ip = config.ip;
    that.token = config.token;
    that.pause = config.pause;
    that.dock = config.dock;
    that.device = null;
    that.startup = true;

    if(!that.ip)
        throw new Error('You must provide an ip address of the vacuum cleaner.');

    if(!that.token)
        throw new Error('You must provide a token of the vacuum cleaner.');

    that.serviceInfo = new Service.AccessoryInformation();
        that.serviceInfo
            .setCharacteristic(Characteristic.Manufacturer, 'Xiaomi')
            .setCharacteristic(Characteristic.Model, 'Roborock')
        that.services.push(that.serviceInfo);

    that.fanService = new Service.Fan(that.name);
        that.fanService
            .getCharacteristic(Characteristic.On)
            .on('get', that.getState.bind(that))
            .on('set', that.setState.bind(that));
        that.fanService
            .getCharacteristic(Characteristic.RotationSpeed)
            .on('get', that.getSpeed.bind(that))
            .on('set', that.setSpeed.bind(that));
        that.services.push(that.fanService);

    that.batteryService = new Service.BatteryService(that.name + ' Battery');
        that.batteryService
            .getCharacteristic(Characteristic.BatteryLevel)
            .on('get', that.getBState.bind(that));
        that.batteryService
            .getCharacteristic(Characteristic.ChargingState)
            .on('get', that.getCState.bind(that));
        that.batteryService
            .getCharacteristic(Characteristic.StatusLowBattery)
            .on('get', that.getBStateLow.bind(that));
        that.services.push(that.batteryService);

    if(that.pause){
        that.pauseService = new Service.Switch(that.name + ' Pause');
            that.pauseService
                .getCharacteristic(Characteristic.On)
                .on('get', that.getPState.bind(that))
                .on('set', that.setPState.bind(that));
            that.services.push(that.pauseService);
    }

    if(that.dock){
        that.dockService = new Service.OccupancySensor(that.name + ' Dock');
            that.dockService
                .getCharacteristic(Characteristic.OccupancyDetected)
                .on('get', that.getDState.bind(that));
            that.services.push(that.dockService);
    }

    that.getDevice();
    that.watch();
}


XiaomiRoborockVacuum.prototype = {

    watch: function() {
        var that = this;
        var log = that.log;

        setInterval(function() {
            that.device = null; // Clear cache
            
            that.getDevice()
            .then(result => {

                ///////////
                /* State */
                log.debug('WATCH | State: ' + result.property("state"));
                switch(result.property("state")){
                    case 'cleaning':
                    //case 'returning':
                    case 'paused':
                    case 'waiting':
                    case 'spot-cleaning':
                        that.fanService.getCharacteristic(Characteristic.On).updateValue(true);
                        break;
                    default:
                        that.fanService.getCharacteristic(Characteristic.On).updateValue(false);
                }

                ////////////////////
                /* Rotation speed */
                log.debug('WATCH | FanSpeed: ' + result.property("fanSpeed"));
                that.fanService.getCharacteristic(Characteristic.RotationSpeed).updateValue(result.property("fanSpeed"));

                /////////////////
                /* Pause state */
                log.debug('WATCH | PauseState: ' + result.property("state"));
                switch(result.property("state")){
                    case 'paused':
                    case 'waiting':
                    //case 'charger-offline':
                        that.pauseService.getCharacteristic(Characteristic.On).updateValue(true);
                        break;
                    default:
                        that.pauseService.getCharacteristic(Characteristic.On).updateValue(false);
                }

                ///////////////////
                /* Battery level */
                log.debug('WATCH | BatteryLevel: ' + result.property("batteryLevel"));
                that.batteryService.getCharacteristic(Characteristic.BatteryLevel).updateValue(result.property("batteryLevel"))

                ///////////////////////
                /* Status low battery*/
                log.debug('WATCH | LowBatteryLevel: ' + result.property("batteryLevel"));
                that.batteryService.getCharacteristic(Characteristic.StatusLowBattery).updateValue((result.property("batteryLevel") < 20) ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);

                ////////////////////
                /* Charging state */
                log.debug('WATCH | ChargingState: ' + result.property("state"));
                switch(result.property("state")){
                    case 'charging':
                        that.batteryService.getCharacteristic(Characteristic.ChargingState).updateValue(Characteristic.ChargingState.CHARGING);
                        break;
                    case 'charger-offline':
                        that.batteryService.getCharacteristic(Characteristic.ChargingState).updateValue(Characteristic.ChargingState.NOT_CHARGEABLE);
                        break;
                    default:
                        that.batteryService.getCharacteristic(Characteristic.ChargingState).updateValue(Characteristic.ChargingState.NOT_CHARGING);
                }

                ////////////////
                /* Dock state */
                log.debug('WATCH | DockState: ' + result.property("state"));
                that.dockService.getCharacteristic(Characteristic.OccupancyDetected).updateValue((result.property("state") == 'charging') ? 1 : 0);

            })
            .catch(err => {
                log.debug('No vacuum cleaner is discovered.');
            });
        }, 30000);
    },


    getDevice: function(){
        var that = this;
        var log = that.log;

        if (that.startup) {
            log.debug('Discovering vacuum cleaner at "%s"', that.ip);
        }

        return new Promise((resolve, reject) => {
            if (that.device != null) {
                resolve(that.device);
                return;
            }

            miio.device({
                address: that.ip,
                token: that.token
            })
            .then(result => {
                if (result.matches('type:vaccuum')) {
                    if (that.startup) {

                        infomodel = result.miioModel;
                        log.info('Connected to: %s', that.ip);
                        log.info('Model: ' + infomodel);
                        log.info('State: ' + result.property("state"));
                        log.info('BatteryLevel: ' + result.property("batteryLevel"));
                        log.info('FanSpeed: ' + result.property("fanSpeed"));

                        ///////////////////
                        /* Serial number */
                        that.getDevice()
                        .then(serialjson => {
                            return result.call("get_serial_number");
                        })
                        .then(serial => {
                            //console.log(serial)
                            serialvalid = JSON.stringify(serial); // Convert in valid JSON
                            serialvalidparse = JSON.parse(serialvalid);
                            log.info('Serialnumber: ' + serialvalidparse[0].serial_number);
                            infoserial = serialvalidparse[0].serial_number;
                        });

                        //////////////////////
                        /* Firmware version */
                        that.getDevice()
                        .then(firmware => {
                            return result.call("miIO.info");
                        })
                        .then(firmware => {
                            //console.log(firmware)
                            firmwarevalid = JSON.stringify(firmware); // Convert in valid JSON
                            firmwarevalidparse = JSON.parse(firmwarevalid);
                            log.info('Firmwareversion: ' + firmwarevalidparse.fw_ver);
                            infofirmware = firmwarevalidparse.fw_ver;
                        });

                        //////////////////////////////////////////
                        /* Number of state (Debug? 100 = Full?) */
                        that.getDevice()
                        .then(numberofstate => {
                            return result.call("get_status");
                        })
                        .then(numberofstate => {
                            //console.log(numberofstate)
                            numberofstatevalid = JSON.stringify(numberofstate); // Convert in valid JSON
                            numberofstatevalidparse = JSON.parse(numberofstatevalid);
                            log.info('Number of state: ' + numberofstatevalidparse[0].state);
                            infonumbstate = numberofstatevalidparse[0].state;
                        });

                        that.startup = false;
                    }

                    that.device = result;
                    resolve(that.device);

                } else {
                    log.debug(result);
                    log.info('%s is not a vacuum cleaner!', that.ip);
                    reject();
                }
            })
            .catch(err => {
                log.debug('No correct API answer from xiaomi/roborock for "%s"', that.ip);
                reject();
            });
        });
    },


    getState: function(callback) {
        var that = this;
        var log = that.log;

        that.getDevice()
        .then(result => {
            log.debug('getState | State: ' + result.property("state"));
            switch(result.property("state")){
                case 'cleaning':
                //case 'returning':
                case 'paused':
                case 'waiting':
                case 'spot-cleaning':
                    callback(null, true);
                    break;
                default:
                    callback(null, false);
            }
        })
        .catch(err => {
            log.debug('No vacuum cleaner is discovered.');
            callback(new Error('No vacuum cleaner is discovered.'));
        });
    },


    setState: function(state, callback) {
        var that = this;
        var log = that.log;

        if(!that.device){
            log.debug('No vacuum cleaner is discovered.');
            callback(new Error('No vacuum cleaner is discovered.'));
            return;
        }

        if(state){
            log.info('Start cleaning.');
            that.device.activateCleaning();
            that.dockService.getCharacteristic(Characteristic.OccupancyDetected).updateValue(0); // Cleaning => leaves dock
        } else {
            log.info('Stop cleaning and go to charge.');
            that.device.activateCharging(); // Charging works for 1st, not for 2nd
        }
        callback();
    },


    getSpeed: function(callback){
        var that = this;
        var log = that.log;

        that.getDevice()
        .then(result => {
            log.debug('getSpeed | FanSpeed: ' + result.property("fanSpeed"));
            callback(null, result.property("fanSpeed"));
        })
        .catch(err => {
            log.debug('No vacuum cleaner is discovered.');
            callback(new Error('No vacuum cleaner is discovered.'));
        });
    },


    setSpeed: function(speed, callback){
        var that = this;
        var log = that.log;

        if(!that.device){
            log.debug('No vacuum cleaner is discovered.');
            callback(new Error('No vacuum cleaner is discovered.'));
            return;
        }

        var cleanupmodes = [
            0,  // 00%      = Off
            38, // 01-38%   = Quiet
            60, // 39-60%   = Balanced
            77, // 61-77%   = Turbo
            90  // 78-100%  = Max Speed
        ];

        log.info('FanSpeed %s% over HomeKit > cleanup.', speed);
        for(var cleanupmode of cleanupmodes) {
            if(speed <= cleanupmode){
                speed = cleanupmode;
                log.info('FanSpeed set to "%s"%.', speed);
                that.device.changeFanSpeed(parseInt(speed));
                that.fanService.getCharacteristic(Characteristic.RotationSpeed).updateValue(speed); // Speed cleaned => set it in HomeKit
                break;
            } 
            if(speed > 90){
                speed = 90;
                log.info('FanSpeed set to "%s"%.', speed);
                that.device.changeFanSpeed(parseInt(speed));
                that.fanService.getCharacteristic(Characteristic.RotationSpeed).updateValue(speed); // Speed cleaned => set it in HomeKit
                break;
            }
        }
        callback(null, speed);
    },


    getPState: function(callback) {
        var that = this;
        var log = that.log;

        that.getDevice()
        .then(result => {
            log.debug('getPState | State: ' + result.property("state"));
            switch(result.property("state")){
                case 'paused':
                case 'waiting':
                //case 'charger-offline':
                    callback(null, true);
                    break;
                default:
                    callback(null, false);
            }
        })
        .catch(err => {
            log.debug('No vacuum cleaner is discovered.');
            callback(new Error('No vacuum cleaner is discovered.'));
        });
    },


    setPState: function(state, callback) {
        var that = this;
        var log = that.log;

        that.getDevice()
        .then(result => {
            log.debug('setPState | State: ' + result.property("state"));

            if(state){
                switch(result.property("state")){
                    case 'cleaning':
                    case 'returning':
                    case 'spot-cleaning':
                        log.info('Pause.');
                        that.device.pause();
                        that.device = null; // Clear cache, refreshDelay in miio
                    break;
                }
            } else {
                switch(result.property("state")){
                    case 'paused':
                    case 'waiting':
                        log.info('Resume cleaning.');
                        that.device.activateCleaning();
                    break;
                }
            }
            callback();
        })
        .catch(err => {
            log.debug('No vacuum cleaner is discovered.');
            callback(new Error('No vacuum cleaner is discovered.'));
        });
    },


    getBState: function(callback) {
        var that = this;
        var log = that.log;

        that.getDevice()
        .then(result => {
            log.debug('getBState | BatteryLevel: ' + result.property("batteryLevel"));

            callback(null, result.property("batteryLevel"));
        })
        .catch(err => {
            log.debug('No vacuum cleaner is discovered.');
            callback(new Error('No vacuum cleaner is discovered.'));
        });
    },


    getBStateLow: function(callback) {
        var that = this;
        var log = that.log;

        that.getDevice()
        .then(result => {
            log.debug('getBStateLow | BatteryLevel: ' + result.property("batteryLevel"));

            callback(null, (result.property("batteryLevel") < 20) ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
        })
        .catch(err => {
            log.debug('No vacuum cleaner is discovered.');
            callback(new Error('No vacuum cleaner is discovered.'));
        });
    },


    getCState: function(callback) {
        var that = this;
        var log = that.log;

        that.getDevice()
        .then(result => {
            log.debug('getCState | State: ' + result.property("state"));

            switch(result.property("state")){
                case 'charging':
                    callback(null, Characteristic.ChargingState.CHARGING);
                    break;
                case 'charger-offline':
                    callback(null, Characteristic.ChargingState.NOT_CHARGEABLE);
                    break;
                default:
                    callback(null, Characteristic.ChargingState.NOT_CHARGING);
            }
        })
        .catch(err => {
            log.debug('No vacuum cleaner is discovered.');
            callback(new Error('No vacuum cleaner is discovered.'));
        });
    },


    getDState: function(callback) {
        var that = this;
        var log = that.log;

        that.getDevice()
        .then(result => {
            log.debug('getDState | State: ' + result.property("state"));

            callback(null, (result.property("state") == 'charging') ? 1 : 0);
        })
        .catch(err => {
            log.debug('No vacuum cleaner is discovered.');
            callback(new Error('No vacuum cleaner is discovered.'));
        });
    },


    identify: function(callback) {
        var that = this;
        var log = that.log;

        that.getDevice()
        .then(result => {
            log.debug('identify | say findme');

            log.info('Find me - Hello!');
            that.device.find();
        })
        .catch(err => {
            log.debug('No vacuum cleaner is discovered.');
            callback(new Error('No vacuum cleaner is discovered.'));
        });
        callback();
    },


    getServices: function() {
        var that = this;
        var log = that.log;

        return that.services;
    }

};