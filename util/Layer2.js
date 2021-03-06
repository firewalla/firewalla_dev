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

'use strict'

const spawn = require('child_process').spawn;
const log = require('../net2/logger.js')(__filename);

const _SimpleCache = require('../util/SimpleCache.js')
const SimpleCache = new _SimpleCache("macCache",60*10);
const notFoundCache = new _SimpleCache("notFoundCache", 15); // do not repeatedly invoke cat /proc/net/arp for the same IP address

const util = require('util')

function getMAC(ipaddress, cb) {

  let _mac = SimpleCache.lookup(ipaddress);
  if (_mac != null) {
      cb(false,_mac);
      return;
  }
  const notFoundRecently = notFoundCache.lookup(ipaddress);
  if (notFoundRecently) {
    cb(false, null);
    return;
  }

  // ping the ip address to encourage the kernel to populate the arp tables
  let ping = spawn("ping", ["-c", "1", ipaddress ]);

  ping.on('exit', function () {
    // not bothered if ping did not work

    let arp = spawn("cat", ["/proc/net/arp"] );
    let buffer = '';
    let errstream = '';
    arp.stdout.on('data', function (data) {
      buffer += data;
    });
    arp.stderr.on('data', function (data) {
      errstream += data;
    });

    arp.on('close', function (code) {
      if (code != 0) {
        log.info("Error running arp " + code + " " + errstream);
        cb(true, code);
      }
      let table = buffer.split('\n');
      let resultReturned = false;
      for ( let l = 0; l < table.length; l++) {

        // parse this format
        //IP address       HW type     Flags       HW address            Mask     Device
        //192.168.1.1      0x1         0x2         50:67:f0:8c:7a:3f     *        em1

        if (l == 0) continue;

        const [ ip, /* type */, flags, mac, /* mask */, /* intf */ ] = table[l].split(' ').filter(Boolean)

        if (!ip || !flags || !mac)
          continue;

        if (flags !== "0x0" && mac !== "00:00:00:00:00:00") {
          SimpleCache.insert(ip, mac.toUpperCase());
          if (ip === ipaddress) {
            cb(false, mac.toUpperCase());
            resultReturned = true;
          }
        } else {
          notFoundCache.insert(ipaddress, true);
          if (ip === ipaddress) {
            cb(false, null);
            resultReturned = true;
          }
        }
      }
      if (!resultReturned) {
        notFoundCache.insert(ipaddress, true);
        cb(false, null)
      }
    });
  });
}

module.exports = {
  getMAC:getMAC,
  getMACAsync: util.promisify(getMAC)
}
