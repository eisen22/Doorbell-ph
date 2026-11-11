package ph.doorbell.gate.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.HelpOutline
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.EventBusy
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ph.doorbell.gate.Rules
import ph.doorbell.gate.ScanResult
import java.time.LocalDate
import java.time.format.DateTimeFormatter

// =====================================================================
// ScannerScreen.kt — THE ONLY SCREEN: SCAN AN ID, SEE THE RESULT
// ---------------------------------------------------------------------
//  top:     school name and today's date
//  middle:  the camera; it reads a card only after "Scan ID" is pressed
//  banner:  the result (green arrived, amber late, grey already in / no class, red card problem)
//  bottom:  the "Scan ID" button
// Every scan is saved to the cloud right away and shows on the website.
// =====================================================================
@Composable
fun ScannerScreen(
    schoolName: String,
    result: ScanResult?,
    scanning: Boolean,
    hint: String?,
    error: String?,
    onScan: () -> Unit,
    onCode: (String) -> Unit,
    onDismissError: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Doorbell.canvas)
            .safeDrawingPadding()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // ----- top bar -----
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Logo(40)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(schoolName.ifBlank { "Doorbell Gate" }, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(LocalDate.parse(Rules.today()).format(DateTimeFormatter.ofPattern("EEEE, MMMM d")), style = MaterialTheme.typography.bodyMedium, color = Doorbell.muted)
            }
        }

        // A save that failed (for example, the database refused it).
        if (error != null) {
            Row(
                Modifier.fillMaxWidth().clip(Radii.md).background(Doorbell.badBg).padding(start = 14.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(error, color = Doorbell.bad, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = onDismissError) { Text("OK", color = Doorbell.bad) }
            }
        }

        // ----- camera -----
        Box(
            Modifier.fillMaxWidth().aspectRatio(1f).clip(Radii.lg).background(Doorbell.ink),
            contentAlignment = Alignment.Center,
        ) {
            CameraScanner(active = scanning, onCode = onCode, modifier = Modifier.fillMaxSize())
            if (scanning) {
                ScanFrame(Modifier.fillMaxSize().padding(36.dp))
            } else {
                // Dimmed while waiting for the button, so it is clear the camera is not reading.
                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
                    Text("Press Scan ID", color = Color.White, style = MaterialTheme.typography.titleMedium)
                }
            }
        }

        // ----- result of the scan -----
        ResultBanner(result, scanning, hint)

        Spacer(Modifier.weight(1f))

        // ----- the scan button -----
        Button(
            onClick = onScan,
            enabled = !scanning,
            shape = Radii.md,
            colors = ButtonDefaults.buttonColors(containerColor = Doorbell.ink, disabledContainerColor = Doorbell.surface, disabledContentColor = Doorbell.muted),
            modifier = Modifier.fillMaxWidth().height(64.dp),
        ) {
            Icon(Icons.Rounded.QrCodeScanner, contentDescription = null, modifier = Modifier.size(26.dp))
            Spacer(Modifier.width(10.dp))
            Text(if (scanning) "Scanning… hold the card in the frame" else "Scan ID", fontSize = if (scanning) 16.sp else 20.sp, textAlign = TextAlign.Center)
        }
    }
}

// Four corner marks that show where to hold the card.
@Composable
private fun ScanFrame(modifier: Modifier) {
    Canvas(modifier) {
        val len = size.minDimension * 0.16f
        val w = 4.dp.toPx()
        val c = Color.White.copy(alpha = 0.9f)
        val (x0, y0, x1, y1) = listOf(0f, 0f, size.width, size.height)
        fun l(a: Offset, b: Offset) = drawLine(c, a, b, strokeWidth = w, cap = StrokeCap.Round)
        l(Offset(x0, y0), Offset(x0 + len, y0)); l(Offset(x0, y0), Offset(x0, y0 + len))
        l(Offset(x1, y0), Offset(x1 - len, y0)); l(Offset(x1, y0), Offset(x1, y0 + len))
        l(Offset(x0, y1), Offset(x0 + len, y1)); l(Offset(x0, y1), Offset(x0, y1 - len))
        l(Offset(x1, y1), Offset(x1 - len, y1)); l(Offset(x1, y1), Offset(x1, y1 - len))
    }
}

// What each result looks like: colors, icon, big line and small line.
private data class BannerLook(val bg: Color, val fg: Color, val icon: ImageVector, val title: String, val detail: String)

private fun lookOf(r: ScanResult?, scanning: Boolean, hint: String?): BannerLook = when (r) {
    null -> when {
        scanning -> BannerLook(Doorbell.frame, Doorbell.ink, Icons.Rounded.QrCodeScanner, "Scanning…", "Hold the ID card inside the frame.")
        hint != null -> BannerLook(Doorbell.lateBg, Doorbell.late, Icons.Rounded.WarningAmber, "No ID found", hint)
        else -> BannerLook(Doorbell.frame, Doorbell.ink, Icons.Rounded.QrCodeScanner, "Ready", "Press Scan ID, then hold the card in front of the camera.")
    }
    is ScanResult.Recorded -> if (r.status == "late") {
        BannerLook(Doorbell.lateBg, Doorbell.late, Icons.Rounded.Schedule, r.student.fullName, "Late · ${Rules.to12h(r.time)} · ${r.section.name}")
    } else {
        BannerLook(Doorbell.okBg, Doorbell.ok, Icons.Rounded.CheckCircle, r.student.fullName, "Arrived ${Rules.to12h(r.time)} · ${r.section.name}")
    }
    is ScanResult.AlreadyIn -> BannerLook(Doorbell.infoBg, Doorbell.info, Icons.Rounded.Replay, r.student.fullName, "Already in since ${Rules.to12h(r.firstScanAt)}")
    is ScanResult.NoClassToday -> BannerLook(Doorbell.surface, Doorbell.muted, Icons.Rounded.EventBusy, r.student.fullName, "No class today for ${r.section.name}")
    is ScanResult.Unknown -> BannerLook(Doorbell.badBg, Doorbell.bad, Icons.AutoMirrored.Rounded.HelpOutline, "Card not recognized", "This is not a Doorbell ID.")
    is ScanResult.Revoked -> BannerLook(Doorbell.badBg, Doorbell.bad, Icons.Rounded.Block, r.student.fullName, "Old card that was replaced.")
    is ScanResult.NotEnrolled -> BannerLook(Doorbell.badBg, Doorbell.bad, Icons.Rounded.WarningAmber, r.student.fullName, "Not in a section yet.")
    ScanResult.Ignored -> lookOf(null, scanning, hint)
}

@Composable
private fun ResultBanner(result: ScanResult?, scanning: Boolean, hint: String?) {
    val look = lookOf(result, scanning, hint)
    AnimatedContent(
        targetState = look,
        transitionSpec = { (fadeIn(tween(160)) + scaleIn(tween(200), initialScale = 0.97f)) togetherWith fadeOut(tween(120)) },
        label = "result",
    ) { l ->
        val plain = l.bg == Doorbell.frame
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 96.dp)
                .clip(Radii.md)
                .background(l.bg)
                .then(if (plain) Modifier.border(1.dp, Doorbell.line, Radii.md) else Modifier)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(l.icon, contentDescription = null, tint = l.fg, modifier = Modifier.size(40.dp))
            Spacer(Modifier.width(14.dp))
            Column {
                Text(l.title, style = MaterialTheme.typography.titleLarge, color = l.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(l.detail, style = MaterialTheme.typography.bodyLarge, color = if (plain) Doorbell.muted else l.fg)
            }
        }
    }
}
