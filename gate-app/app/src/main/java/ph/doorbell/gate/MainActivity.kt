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
import androidx.compose.foundation.layout.Box
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
import ph.doorbell.gate.ui.DoorbellTheme
import ph.doorbell.gate.ui.Doorbell
import ph.doorbell.gate.ui.Feedback
import ph.doorbell.gate.ui.Logo
import ph.doorbell.gate.ui.Radii
import ph.doorbell.gate.ui.ScannerScreen
import ph.doorbell.gate.ui.SignInScreen

// =====================================================================
// MainActivity.kt — WHERE THE APP STARTS
// Shows the sign-in screen or the scanner, asks for the camera once, and keeps the
// screen on while scanning (the gate phone stays on its stand all morning).
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
    when (screen) {
        GateViewModel.Screen.Loading -> Box(Modifier.fillMaxSize().background(Doorbell.canvas), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Doorbell.ink)
        }
        GateViewModel.Screen.SignIn -> {
            val busy by vm.busy.collectAsStateWithLifecycle()
            val error by vm.signInError.collectAsStateWithLifecycle()
            SignInScreen(busy = busy, error = error, onSignIn = vm::signIn)
        }
        GateViewModel.Screen.Scanner -> WithCameraPermission {
            val context = LocalContext.current
            val feedback = remember { Feedback(context) }
            DisposableEffect(Unit) { onDispose { feedback.release() } }
            val status by vm.repo.status.collectAsStateWithLifecycle()
            val result by vm.result.collectAsStateWithLifecycle()
            val recent by vm.recent.collectAsStateWithLifecycle()
            val error by vm.repo.saveError.collectAsStateWithLifecycle()
            ScannerScreen(
                status = status,
                result = result,
                recent = recent,
                error = error,
                onCode = { code -> vm.onCode(code)?.let(feedback::play) },
                onDismissError = vm::clearError,
                onSignOut = vm::signOut,
            )
        }
    }
}

// Asks for the camera the first time; explains why if the guard said no.
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
        Column(
            Modifier.fillMaxSize().background(Doorbell.canvas).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
        ) {
            Logo(48)
            Text("Doorbell Gate needs the camera", style = MaterialTheme.typography.headlineMedium)
            Text("The camera reads the QR code or barcode on each child's ID card. Nothing is recorded or saved as a picture.", color = Doorbell.muted)
            Button(
                onClick = { ask.launch(Manifest.permission.CAMERA) },
                shape = Radii.sm,
                colors = ButtonDefaults.buttonColors(containerColor = Doorbell.ink),
                modifier = Modifier.fillMaxWidth().height(54.dp),
            ) { Text("Allow camera") }
        }
    }
}
