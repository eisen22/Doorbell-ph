package ph.doorbell.gate.ui

import androidx.annotation.OptIn
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

// =====================================================================
// CameraScanner.kt — THE LIVE CAMERA THAT READS ID CARDS
// ---------------------------------------------------------------------
// CameraX shows the back camera; every frame goes to ML Kit, which finds QR codes and
// CODE-128 barcodes (the two kinds Doorbell prints on ID cards). It runs on the phone, so it
// works without internet. onCode() is called with the text inside the code.
// =====================================================================
@OptIn(ExperimentalGetImage::class)
@Composable
fun CameraScanner(torchOn: Boolean, onCode: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    val latestOnCode by rememberUpdatedState(onCode)
    var camera by remember { mutableStateOf<Camera?>(null) }

    DisposableEffect(owner) {
        val executor = Executors.newSingleThreadExecutor() // frames are read off the main thread
        val reader = BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE, Barcode.FORMAT_CODE_128).build(),
        )
        val providerFuture = ProcessCameraProvider.getInstance(context)
        providerFuture.addListener({
            val provider = providerFuture.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST) // skip frames while busy
                .build()
            analysis.setAnalyzer(executor) { frame ->
                val media = frame.image
                if (media == null) {
                    frame.close()
                    return@setAnalyzer
                }
                val image = InputImage.fromMediaImage(media, frame.imageInfo.rotationDegrees)
                reader.process(image)
                    .addOnSuccessListener { codes -> codes.firstNotNullOfOrNull { it.rawValue }?.let { latestOnCode(it) } }
                    .addOnCompleteListener { frame.close() } // always release the frame, or the camera stops
            }
            provider.unbindAll()
            camera = provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        }, ContextCompat.getMainExecutor(context))

        onDispose {
            runCatching { providerFuture.get().unbindAll() }
            reader.close()
            executor.shutdown()
        }
    }

    // The flashlight button (useful early in the morning or under a dark gate roof).
    LaunchedEffect(torchOn, camera) { camera?.cameraControl?.enableTorch(torchOn) }

    AndroidView(factory = { previewView }, modifier = modifier)
}
