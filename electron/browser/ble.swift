// Hears phones answering a passkey QR code (passkeys.ts), only listening: `advert <hex>` per FIDO service data, `state
// on|off|unauthorized|unsupported`. Ends when its stdin closes.
import CoreBluetooth
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

final class Listener: NSObject, CBCentralManagerDelegate {
  // FIDO's 16-bit service UUID, and Google's that older Android phones used
  let services = [CBUUID(string: "FFF9"), CBUUID(string: "FDE2")]
  var central: CBCentralManager!

  override init() {
    super.init()
    central = CBCentralManager(delegate: self, queue: nil)
  }

  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    switch c.state {
    case .poweredOn:
      print("state on")
      // (no service filter: a phone's advert carries the UUID only as its service data's key)
      c.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    case .poweredOff: print("state off")
    case .unauthorized: print("state unauthorized")
    case .unsupported: print("state unsupported")
    default: break
    }
  }

  func centralManager(_ c: CBCentralManager, didDiscover _: CBPeripheral, advertisementData ad: [String: Any], rssi _: NSNumber) {
    guard let data = ad[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data] else { return }
    for s in services {
      if let d = data[s] { print("advert " + d.map { String(format: "%02x", $0) }.joined()) }
    }
  }
}

let listener = Listener()
FileHandle.standardInput.readabilityHandler = { h in
  if h.availableData.isEmpty { exit(0) }
}
RunLoop.main.run()
