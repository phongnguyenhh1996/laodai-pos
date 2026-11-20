package vn.laodai.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Máy in nhiệt 58mm qua Bluetooth Classic (SPP / RFCOMM). Web gửi sẵn bytes ESC/POS (base64), plugin chỉ ghi ra socket.
 * Chỉ liệt kê máy đã ghép đôi trong Cài đặt Android (không quét) ⇒ Android 12+ chỉ cần quyền BLUETOOTH_CONNECT.
 */
@SuppressLint("MissingPermission")
@CapacitorPlugin(
    name = "LaodaiPrinter",
    permissions = { @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }) }
)
public class LaodaiPrinterPlugin extends Plugin {

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    /** Một luồng cho mọi thao tác socket ⇒ ghi lần lượt, không chồng lệnh. */
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private BluetoothSocket socket;
    private OutputStream out;
    private String address;

    private final BroadcastReceiver aclReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            BluetoothDevice d = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            if (d != null && d.getAddress().equals(address)) {
                closeQuietly();
                notifyListeners("disconnected", new JSObject());
            }
        }
    };

    @Override
    public void load() {
        getContext().registerReceiver(aclReceiver, new IntentFilter(BluetoothDevice.ACTION_ACL_DISCONNECTED));
    }

    @Override
    protected void handleOnDestroy() {
        try {
            getContext().unregisterReceiver(aclReceiver);
        } catch (IllegalArgumentException ignored) {}
        closeQuietly();
        io.shutdown();
    }

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    /** Android 12+ hỏi quyền "Thiết bị ở gần" lúc dùng; Android cũ đã có quyền BLUETOOTH khi cài. */
    private boolean hasPermission(PluginCall call, String callback) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, callback);
            return false;
        }
        return true;
    }

    private BluetoothAdapter readyAdapter(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) {
            call.reject("Máy không có Bluetooth");
            return null;
        }
        if (!a.isEnabled()) {
            call.reject("Bluetooth đang tắt");
            return null;
        }
        return a;
    }

    @PermissionCallback
    private void listPairedPermission(PluginCall call) {
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) listPaired(call);
        else call.reject("Chưa cho phép dùng Bluetooth");
    }

    @PermissionCallback
    private void connectPermission(PluginCall call) {
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) connect(call);
        else call.reject("Chưa cho phép dùng Bluetooth");
    }

    @PluginMethod
    public void listPaired(PluginCall call) {
        if (!hasPermission(call, "listPairedPermission")) return;
        BluetoothAdapter a = readyAdapter(call);
        if (a == null) return;
        JSArray list = new JSArray();
        for (BluetoothDevice d : a.getBondedDevices()) {
            JSObject o = new JSObject();
            o.put("name", d.getName() == null ? d.getAddress() : d.getName());
            o.put("address", d.getAddress());
            list.put(o);
        }
        JSObject r = new JSObject();
        r.put("devices", list);
        call.resolve(r);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        if (!hasPermission(call, "connectPermission")) return;
        String addr = call.getString("address");
        if (addr == null || !BluetoothAdapter.checkBluetoothAddress(addr)) {
            call.reject("Địa chỉ máy in không hợp lệ");
            return;
        }
        BluetoothAdapter a = readyAdapter(call);
        if (a == null) return;
        io.execute(() -> {
            closeQuietly();
            try {
                a.cancelDiscovery();
                BluetoothDevice d = a.getRemoteDevice(addr);
                BluetoothSocket s;
                try {
                    s = d.createRfcommSocketToServiceRecord(SPP);
                    s.connect();
                } catch (IOException first) {
                    // Một số máy in rẻ chỉ nhận kết nối không mã hóa.
                    s = d.createInsecureRfcommSocketToServiceRecord(SPP);
                    s.connect();
                }
                socket = s;
                out = s.getOutputStream();
                address = addr;
                call.resolve();
            } catch (Exception e) {
                closeQuietly();
                call.reject("Không kết nối được: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Thiếu dữ liệu in");
            return;
        }
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Dữ liệu in không hợp lệ");
            return;
        }
        io.execute(() -> {
            if (out == null) {
                call.reject("Chưa kết nối máy in");
                return;
            }
            try {
                out.write(bytes);
                out.flush();
                call.resolve();
            } catch (IOException e) {
                closeQuietly();
                notifyListeners("disconnected", new JSObject());
                call.reject("Mất kết nối máy in: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        io.execute(() -> {
            closeQuietly();
            call.resolve();
        });
    }

    private void closeQuietly() {
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {}
        socket = null;
        out = null;
        address = null;
    }
}
