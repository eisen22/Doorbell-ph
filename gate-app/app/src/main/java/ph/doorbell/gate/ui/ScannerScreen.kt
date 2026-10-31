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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.EventBusy
import androidx.compose.material.icons.rounded.FlashlightOff
import androidx.compose.material.icons.rounded.FlashlightOn
import androidx.compose.material.icons.automirrored.rounded.HelpOutline
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Replay
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ph.doorbell.gate.GateStatus
import ph.doorbell.gate.RecentScan
import ph.doorbell.gate.Rules
import ph.doorbell.gate.ScanResult
import ph.doorbell.gate.Tone
import java.time.LocalDate
import java.time.format.DateTimeFormatter

// =====================================================================
// ScannerScreen.kt — THE SCREEN THE GUARD SEES ALL MORNING
// ---------------------------------------------------------------------
//  top:     school name, today's date, how many children are in, flashlight, sign out
//  middle:  the camera; hold the ID card inside the frame
//  banner:  the result of the last scan in big letters (green arrived, amber late,
//           grey already in / no class, red problem with the card)
//  bottom:  the most recent scans
// =====================================================================
@Composable
fun ScannerScreen(
    status: GateStatus,
    result: ScanResult?,
    recent: List<RecentScan>,
    error: String?,
    onCode: (String) -> Unit,
    onDismissError: () -> Unit,
    onSignOut: () -> Unit,
) {
    var torch by remember { mutableStateOf(false) }
    var askSignOut by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Doorbell.canvas)
            .safeDrawingPadding()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // ----- top bar -----
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Logo(40)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(status.schoolName.ifBlank { "Doorbell Gate" }, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(LocalDate.parse(Rules.today()).format(DateTimeFormatter.ofPattern("EEEE, MMMM d")), style = MaterialTheme.typography.bodyMedium, color = Doorbell.muted)
            }
            IconButton(onClick = { torch = !torch }) {
                Icon(if (torch) Icons.Rounded.FlashlightOn else Icons.Rounded.FlashlightOff, contentDescription = if (torch) "Turn off flashlight" else "Turn on flashlight")
            }
            IconButton(onClick = { askSignOut = true }) {
                Icon(Icons.AutoMirrored.Rounded.Logout, contentDescription = "Sign out")
            }
        }

        // ----- arrivals today -----
        Row(
            Modifier
                .fillMaxWidth()
                .clip(Radii.md)
                .background(Doorbell.frame)
                .border(1.dp, Doorbell.line, Radii.md)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (status.classToday) "Arrived today" else "No class today",
                style = MaterialTheme.typography.bodyLarge,
                color = Doorbell.muted,
                modifier = Modifier.weight(1f),
            )
            if (status.classToday) {
                Text("${status.arrived}", style = MaterialTheme.typography.titleLarge)
                Text(" of ${status.expected}", style = MaterialTheme.typography.bodyLarge, color = Doorbell.muted)
            }
        }

        if (error != null) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(Radii.md)
                    .background(Doorbell.badBg)
                    .padding(start = 14.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(error, color = Doorbell.bad, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = onDismissError) { Text("OK", color = Doorbell.bad) }
            }
        }

        // ----- camera -----
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1.15f)
                .clip(Radii.lg)
                .background(Doorbell.ink),
        ) {
            CameraScanner(torchOn = torch, onCode = onCode, modifier = Modifier.fillMaxSize())
            ScanFrame(Modifier.fillMaxSize().padding(36.dp))
        }

        // ----- result of the last scan -----
        ResultBanner(result)

        // ----- recent scans -----
        Text("Recent scans", style = MaterialTheme.typography.labelMedium, color = Doorbell.muted)
        LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
            itemsIndexed(recent) { i, r ->
                RecentRow(r)
                if (i < recent.lastIndex) Box(Modifier.fillMaxWidth().padding(start = 22.dp).heightIn(min = 1.dp).background(Doorbell.line))
            }
        }
    }

    if (askSignOut) {
        // Asked first, so a child pressing the button cannot stop the scanner by accident.
        AlertDialog(
            onDismissRequest = { askSignOut = false },
            title = { Text("Sign out the gate phone?") },
            text = { Text("Scanning stops until someone signs in again with the gate account.") },
            confirmButton = { TextButton(onClick = { askSignOut = false; onSignOut() }) { Text("Sign out", color = Doorbell.bad) } },
            dismissButton = { TextButton(onClick = { askSignOut = false }) { Text("Keep scanning") } },
            shape = Radii.lg,
            containerColor = Doorbell.frame,
        )
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

private fun lookOf(r: ScanResult?): BannerLook = when (r) {
    null -> BannerLook(Doorbell.frame, Doorbell.ink, Icons.Rounded.QrCodeScanner, "Ready to scan", "Hold the ID card inside the frame.")
    is ScanResult.Recorded -> if (r.status == "late") {
        BannerLook(Doorbell.lateBg, Doorbell.late, Icons.Rounded.Schedule, r.student.fullName, "Late · ${Rules.to12h(r.time)} · ${r.section.name}${if (r.parentTexted) " · parent texted" else ""}")
    } else {
        BannerLook(Doorbell.okBg, Doorbell.ok, Icons.Rounded.CheckCircle, r.student.fullName, "Arrived ${Rules.to12h(r.time)} · ${r.section.name}${if (r.parentTexted) " · parent texted" else ""}")
    }
    is ScanResult.AlreadyIn -> BannerLook(Doorbell.infoBg, Doorbell.info, Icons.Rounded.Replay, r.student.fullName, "Already in since ${Rules.to12h(r.firstScanAt)}")
    is ScanResult.NoClassToday -> BannerLook(Doorbell.surface, Doorbell.muted, Icons.Rounded.EventBusy, r.student.fullName, "No class today for ${r.section.name}")
    is ScanResult.Unknown -> BannerLook(Doorbell.badBg, Doorbell.bad, Icons.AutoMirrored.Rounded.HelpOutline, "Card not recognized", "This is not a Doorbell ID. Send the child to the office.")
    is ScanResult.Revoked -> BannerLook(Doorbell.badBg, Doorbell.bad, Icons.Rounded.Block, r.student.fullName, "Old card that was replaced. Ask the office for the new card.")
    is ScanResult.NotEnrolled -> BannerLook(Doorbell.badBg, Doorbell.bad, Icons.Rounded.WarningAmber, r.student.fullName, "Not in a section yet. Ask the office.")
    ScanResult.Ignored -> lookOf(null)
}

@Composable
private fun ResultBanner(result: ScanResult?) {
    AnimatedContent(
        targetState = result,
        transitionSpec = { (fadeIn(tween(160)) + scaleIn(tween(200), initialScale = 0.97f)) togetherWith fadeOut(tween(120)) },
        label = "result",
    ) { r ->
        val look = lookOf(r)
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 96.dp)
                .clip(Radii.md)
                .background(look.bg)
                .then(if (r == null) Modifier.border(1.dp, Doorbell.line, Radii.md) else Modifier)
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(look.icon, contentDescription = null, tint = look.fg, modifier = Modifier.size(40.dp))
            Spacer(Modifier.width(14.dp))
            Column {
                Text(look.title, style = MaterialTheme.typography.titleLarge, color = if (r == null) Doorbell.ink else look.fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(look.detail, style = MaterialTheme.typography.bodyLarge, color = if (r == null) Doorbell.muted else look.fg)
            }
        }
    }
}

@Composable
private fun RecentRow(r: RecentScan) {
    val dot = when (r.tone) {
        Tone.OK -> Doorbell.ok
        Tone.LATE -> Doorbell.late
        Tone.INFO -> Doorbell.info
        Tone.BAD -> Doorbell.bad
    }
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(androidx.compose.foundation.shape.CircleShape).background(dot))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(r.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(r.detail, style = MaterialTheme.typography.bodyMedium, color = Doorbell.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(r.at, style = MaterialTheme.typography.bodyMedium, color = Doorbell.muted)
    }
}
