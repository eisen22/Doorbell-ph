package ph.doorbell.gate.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ph.doorbell.gate.R

// =====================================================================
// Theme.kt — COLORS, FONT AND CORNERS (the same as the website's style.css)
// Change a color here and every screen follows.
// =====================================================================
object Doorbell {
    val canvas = Color(0xFFF5F5F1) // page background
    val frame = Color(0xFFFFFFFF) // cards
    val surface = Color(0xFFF1F2EC)
    val line = Color(0xFFE0E2DA)
    val ink = Color(0xFF1B1D19) // main text
    val muted = Color(0xFF62685D) // secondary text
    val lime = Color(0xFFD8F29F) // brand highlight
    val limeInk = Color(0xFF33500B)
    val ok = Color(0xFF1D7A45)
    val okBg = Color(0xFFE2F3E6)
    val late = Color(0xFF8F5400)
    val lateBg = Color(0xFFFDEFD2)
    val bad = Color(0xFFB42318)
    val badBg = Color(0xFFFBE9E6)
    val info = Color(0xFF464CA8)
    val infoBg = Color(0xFFEAECFB)
}

object Radii {
    val sm = SquircleShape(10.dp)
    val md = SquircleShape(14.dp)
    val lg = SquircleShape(20.dp)
}

// Plus Jakarta Sans, the website's font (files in res/font).
val Jakarta = FontFamily(
    Font(R.font.jakarta_regular, FontWeight.Normal),
    Font(R.font.jakarta_semibold, FontWeight.SemiBold),
    Font(R.font.jakarta_bold, FontWeight.Bold),
)

private val type = Typography(
    headlineMedium = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 28.sp, lineHeight = 34.sp, letterSpacing = (-0.4).sp),
    titleLarge = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 28.sp),
    titleMedium = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontFamily = Jakarta, fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontFamily = Jakarta, fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
    labelMedium = TextStyle(fontFamily = Jakarta, fontWeight = FontWeight.SemiBold, fontSize = 13.sp),
)

@Composable
fun DoorbellTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Doorbell.ink,
            onPrimary = Color.White,
            secondary = Doorbell.lime,
            onSecondary = Doorbell.limeInk,
            background = Doorbell.canvas,
            onBackground = Doorbell.ink,
            surface = Doorbell.frame,
            onSurface = Doorbell.ink,
            surfaceVariant = Doorbell.surface,
            onSurfaceVariant = Doorbell.muted,
            outline = Doorbell.line,
            error = Doorbell.bad,
        ),
        typography = type,
        content = content,
    )
}
