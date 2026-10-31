package ph.doorbell.gate.ui

import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import kotlin.math.min

// =====================================================================
// Squircle.kt — APPLE-STYLE "CONTINUOUS" CORNERS
// ---------------------------------------------------------------------
// A normal rounded corner is a quarter circle: the curve starts suddenly. A squircle corner
// starts a little earlier and bends gradually, like iPhone app icons. Same rule as the website:
// the radius is about 7% (big panels) to 18% (small buttons) of the element's height.
//   Radii.sm  = buttons and fields (about 48-56dp tall)
//   Radii.md  = banners and list rows
//   Radii.lg  = cards and the camera window
// =====================================================================
class SquircleShape(private val radius: Dp) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val r = with(density) { radius.toPx() }
        // The curve uses 1.3x the radius of space and its handles sit close to the corner,
        // which looks as round as a circle corner of `radius` but smoother.
        val e = min(r * 1.3f, min(size.width, size.height) / 2f)
        val k = e * 0.28f // how close the handles are to the sharp corner (smaller = squarer)
        val w = size.width
        val h = size.height
        val p = Path().apply {
            moveTo(e, 0f)
            lineTo(w - e, 0f)
            cubicTo(w - k, 0f, w, k, w, e) // top-right corner
            lineTo(w, h - e)
            cubicTo(w, h - k, w - k, h, w - e, h) // bottom-right
            lineTo(e, h)
            cubicTo(k, h, 0f, h - k, 0f, h - e) // bottom-left
            lineTo(0f, e)
            cubicTo(0f, k, k, 0f, e, 0f) // top-left
            close()
        }
        return Outline.Generic(p)
    }
}
