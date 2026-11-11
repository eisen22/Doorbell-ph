package ph.doorbell.gate

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import ph.doorbell.gate.ui.Doorbell
import ph.doorbell.gate.ui.DoorbellTheme
import ph.doorbell.gate.ui.Feedback
import ph.doorbell.gate.ui.Logo
import ph.doorbell.gate.ui.Radii
import ph.doorbell.gate.ui.ScannerScreen

// =====================================================================
// MainActivity.kt — WHERE THE APP STARTS
// Connects to Doorbell by itself (no sign-in screen), asks for the camera once, and keeps the
// screen on while the app is open.
// =====================================================================
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent { DoorbellTheme { DoorbellGateApp() } }
    }
}

@Composable
private fun DoorbellGateApp(vm: GateViewModel = viewModel()) {
    val screen by vm.screen.collectAsStateWithLifecycle()
    when (val sc = screen) {
        GateViewModel.Screen.Loading -> Message(title = "Connecting to Doorbell…", busy = true)
        is GateViewModel.Screen.Problem -> Message(title = "Can't connect to Doorbell", detail = sc.message, action = "Try again", onAction = vm::connect)
        GateViewModel.Screen.Scanner -> WithCameraPermission {
            val context = LocalContext.current
            val feedback = remember { Feedback(context) }
            DisposableEffect(Unit) { onDispose { feedback.release() } }
            val status by vm.repo.status.collectAsStateWithLifecycle()
            val result by vm.result.collectAsStateWithLifecycle()
            val scanning by vm.scanning.collectAsStateWithLifecycle()
            val hint by vm.hint.collectAsStateWithLifecycle()
            val error by vm.repo.saveError.collectAsStateWithLifecycle()
            // "Gate phone's SIM" mode: ask once for permission to send texts (Android's own dialog).
            val phoneSms by vm.repo.phoneSms.collectAsStateWithLifecycle()
            val askSms = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
            LaunchedEffect(phoneSms) { if (phoneSms && !vm.sms.hasPermission()) askSms.launch(Manifest.permission.SEND_SMS) }
            ScannerScreen(
                schoolName = status.schoolName,
                result = result,
                scanning = scanning,
                hint = hint,
                error = error,
                onScan = vm::startScan,
                onCode = { code -> vm.onCode(code)?.let(feedback::play) },
                onDismissError = vm::clearError,
            )
        }
    }
}

// A full screen with the logo and a message: while connecting, or when something is wrong.
@Composable
private fun Message(title: String, detail: String? = null, busy: Boolean = false, action: String? = null, onAction: () -> Unit = {}) {
    Column(
        Modifier.fillMaxSize().background(Doorbell.canvas).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Logo(48)
        Text(title, style = MaterialTheme.typography.headlineMedium)
        if (detail != null) Text(detail, color = Doorbell.muted)
        if (busy) CircularProgressIndicator(color = Doorbell.ink)
        if (action != null) {
            Button(
                onClick = onAction,
                shape = Radii.sm,
                colors = ButtonDefaults.buttonColors(containerColor = Doorbell.ink),
                modifier = Modifier.fillMaxWidth().height(54.dp),
            ) { Text(action) }
        }
    }
}

// Asks for the camera the first time; explains why if it was refused.
@Composable
private fun WithCameraPermission(content: @Composable () -> Unit) {
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }
    if (granted) {
        content()
    } else {
        Message(
            title = "Doorbell Gate needs the camera",
            detail = "The camera reads the QR code or barcode on each child's ID card. No pictures are saved.",
            action = "Allow camera",
            onAction = { ask.launch(Manifest.permission.CAMERA) },
        )
    }
}
