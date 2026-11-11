package ph.doorbell.gate.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import ph.doorbell.gate.R

/** The Doorbell logo: the mark on its lime tile. */
@Composable
fun Logo(sizeDp: Int) {
    Box(
        Modifier
            .size(sizeDp.dp)
            .clip(SquircleShape((sizeDp * 0.23f).dp))
            .background(Doorbell.lime),
        contentAlignment = Alignment.Center,
    ) {
        Image(painterResource(R.drawable.doorbell_mark), contentDescription = null, modifier = Modifier.size((sizeDp * 0.75f).dp))
    }
}
