package com.pospro.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * CashDrawer native plugin (Android USB Host).
 *
 * Sends an ESC/POS "open cash drawer" pulse to the first USB device that
 * exposes a Bulk OUT endpoint (i.e. a USB receipt printer or a USB-serial
 * cash drawer). No third-party driver library is required — we talk USB Host
 * directly, which covers USB Printer-class and CDC-ACM devices (the common
 * case for POS printers with a drawer kick port).
 *
 * Register a device filter in AndroidManifest (or rely on the system picker)
 * and pair the drawer with a receipt printer's kick output. The pulse bytes
 * are sent from JS (default 1B 70 00 19 19 = ESC p m t s, drawer #1).
 */
@CapacitorPlugin(name = "CashDrawer")
public class CashDrawerPlugin extends Plugin {

    private static final String TAG = "CashDrawer";

    // ESC/POS open cash drawer #1: ESC p m t s  =>  1B 70 00 19 19
    private static final byte[] DEFAULT_PULSE = { 0x1b, 0x70, 0x00, 0x19, 0x19 };

    @PluginMethod
    public void open(PluginCall call) {
        try {
            int vid = call.getInt("vid", -1);
            int pid = call.getInt("pid", -1);
            byte[] pulse = parsePulse(call.getString("pulseHex"), DEFAULT_PULSE);

            UsbManager um = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
            if (um == null) {
                call.reject("USB Host not supported on this device");
                return;
            }

            UsbDevice device = null;
            UsbInterface intf = null;
            UsbEndpoint epOut = null;

            for (UsbDevice d : um.getDeviceList().values()) {
                if (vid > 0 && d.getVendorId() != vid) continue;
                if (pid > 0 && d.getProductId() != pid) continue;
                UsbInterface candidate = findBulkOutInterface(d);
                if (candidate != null) {
                    UsbEndpoint out = getBulkOutEndpoint(candidate);
                    if (out != null) {
                        device = d;
                        intf = candidate;
                        epOut = out;
                        break;
                    }
                }
            }

            if (device == null || intf == null || epOut == null) {
                if (vid > 0 || pid > 0) {
                    call.reject("No USB device matched the configured vendor/product id");
                } else {
                    call.reject("No USB cash drawer / printer found — connect one and try again");
                }
                return;
            }

            // First time the OS requires explicit USB permission from the user.
            if (!um.hasPermission(device)) {
                Intent intent = new Intent(UsbManager.ACTION_USB_PERMISSION);
                intent.setPackage(getContext().getPackageName());
                PendingIntent pi = PendingIntent.getBroadcast(
                        getContext(), 0, intent,
                        PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                um.requestPermission(device, pi);

                JSObject res = new JSObject();
                res.put("opened", false);
                res.put("method", "native");
                res.put("device", device.getDeviceName());
                res.put("error", "permission_requested");
                call.resolve(res);
                return;
            }

            UsbDeviceConnection conn = um.openDevice(device);
            if (conn == null) {
                call.reject("Cannot open USB device — grant USB permission in Android Settings");
                return;
            }

            boolean claimed = conn.claimInterface(intf, true);
            if (!claimed) {
                conn.close();
                call.reject("Cannot claim USB interface");
                return;
            }

            int written = conn.bulkTransfer(epOut, pulse, pulse.length, 2000);
            conn.releaseInterface(intf);
            conn.close();

            if (written < 0) {
                call.reject("USB write failed — check cable / drawer connection");
                return;
            }

            JSObject res = new JSObject();
            res.put("opened", true);
            res.put("method", "native");
            res.put("device", device.getDeviceName());
            res.put("bytes", written);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "Cash drawer open failed", e);
            call.reject("Cash drawer error: " + e.getMessage());
        }
    }

    private static UsbInterface findBulkOutInterface(UsbDevice device) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface intf = device.getInterface(i);
            if (getBulkOutEndpoint(intf) != null) {
                return intf;
            }
        }
        return null;
    }

    private static UsbEndpoint getBulkOutEndpoint(UsbInterface intf) {
        for (int i = 0; i < intf.getEndpointCount(); i++) {
            UsbEndpoint ep = intf.getEndpoint(i);
            if (ep.getType() == UsbEndpoint.USB_ENDPOINT_XFER_BULK
                    && ep.getDirection() == UsbEndpoint.USB_DIR_OUT) {
                return ep;
            }
        }
        return null;
    }

    private static byte[] parsePulse(String hex, byte[] fallback) {
        if (hex == null || hex.isEmpty()) return fallback;
        String cleaned = hex.replaceAll("\\s+", "");
        if (cleaned.length() % 2 != 0) return fallback;
        byte[] out = new byte[cleaned.length() / 2];
        try {
            for (int i = 0; i < out.length; i++) {
                out[i] = (byte) Integer.parseInt(cleaned.substring(i * 2, i * 2 + 2), 16);
            }
            return out;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
