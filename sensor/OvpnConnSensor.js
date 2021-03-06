/*    Copyright 2016-2021 Firewalla Inc.
 *
 *    This program is free software: you can redistribute it and/or  modify
 *    it under the terms of the GNU Affero General Public License, version 3,
 *    as published by the Free Software Foundation.
 *
 *    This program is distributed in the hope that it will be useful,
 *    but WITHOUT ANY WARRANTY; without even the implied warranty of
 *    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *    GNU Affero General Public License for more details.
 *
 *    You should have received a copy of the GNU Affero General Public License
 *    along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
'use strict';

const log = require('../net2/logger.js')(__filename);
const util = require('util');
const sem = require('../sensor/SensorEventManager.js').getInstance();
const LogReader = require('../util/LogReader.js');
const Sensor = require('./Sensor.js').Sensor;
const Message = require('../net2/Message.js');
const {Address4, Address6} = require('ip-address');

class OvpnConnSensor extends Sensor {
  initLogWatcher() {
    if (this.ovpnLog == null) {
      this.ovpnLog = new LogReader(this.config.logPath, true);
      this.ovpnLog.on('line', this.processOvpnLog.bind(this));
      this.ovpnLog.watch();
    }
  }

  run() {
    this.initLogWatcher();
  }

  processOvpnLog(data) {
    if (data.includes(": pool returned")) {
      try {
        // vpn client connection accepted
        const words = data.split(/\s+/, 6);
        const remote = words[5];
        const peers = data.substr(data.indexOf('pool returned') + 14);
        // remote should be <name>/<ip>:<port> or <name>/<ip> if "multihome" option is enabled in server.conf
        const profile = remote.split('/')[0];
        const client = remote.split('/')[1];
        let clientIP = null;
        let clientPort = null;
        if (new Address4(client).isValid() || new Address6(client).isValid()) {
          // bare IPv4(6) address
          clientIP = client;
          clientPort = 0;
        } else {
          // IPv4(6):port
          clientIP = client.includes(":") ? client.substring(0, client.lastIndexOf(":")) : client;
          clientPort = client.includes(":") ? client.substring(client.lastIndexOf(":") + 1) : 0;
        }
        // peerIP4 should be IPv4=<ip>,
        const peerIP4 = peers.split(', ')[0];
        let peerIPv4Address = peerIP4.split('=')[1];
        if (peerIPv4Address === "(Not enabled)") {
          peerIPv4Address = null;
        }
        // peerIP6 should be IPv6=<ip>
        const peerIP6 = peers.split(', ')[1];
        let peerIPv6Address = peerIP6.split('=')[1];
        if (peerIPv6Address === "(Not enabled)") {
          peerIPv6Address = null;
        }
        log.info(util.format("VPN client connection accepted, remote: %s, peer ipv4: %s, peer ipv6: %s, profile: %s", client, peerIPv4Address, peerIPv6Address, profile));
        const event = {
          type: Message.MSG_OVPN_CONN_ACCEPTED,
          message: "A new VPN connection was accepted",
          client: {
            remoteIP: clientIP,
            remotePort: clientPort,
            peerIP4: peerIPv4Address,
            peerIP6: peerIPv6Address,
            profile: profile
          }
        };
        sem.sendEventToAll(event);
        sem.emitLocalEvent(event);
      } catch(err) {
        log.error("Error processing VPN log", err)
      }
    }
  }
}

module.exports = OvpnConnSensor;
