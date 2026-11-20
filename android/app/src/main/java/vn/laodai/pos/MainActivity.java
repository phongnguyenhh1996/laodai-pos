package vn.laodai.pos;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin máy in Bluetooth (SPP) cho phiếu bếp + bill.
        registerPlugin(LaodaiPrinterPlugin.class);
        super.onCreate(savedInstanceState);
        // Tablet quầy: màn hình luôn sáng (vẫn dùng được "ghim màn hình" của Android).
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
