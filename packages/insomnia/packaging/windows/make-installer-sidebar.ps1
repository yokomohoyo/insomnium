# Draws installerSidebar.bmp, the picture down the left of the installer's
# finish page and of the uninstaller's welcome and finish pages. NSIS wants
# 164x314, 24-bit. The moon is cut from the app icon; the rest is drawn here.
#
#   powershell -File make-installer-sidebar.ps1 [-Preview out.png]
param([string]$Preview)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$w = 164; $h = 314
$s = 4 # drawn at 4x and scaled down, so clipped edges come out smooth

function Color([string]$hex, [int]$alpha = 255) {
    $c = [System.Drawing.ColorTranslator]::FromHtml($hex)
    [System.Drawing.Color]::FromArgb($alpha, $c)
}

$icon = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot '../../src/icons/512x512.png'))
$big = New-Object System.Drawing.Bitmap ($w * $s), ($h * $s), ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($big)
$g.SmoothingMode = 'AntiAlias'
$g.InterpolationMode = 'HighQualityBicubic'
$g.PixelOffsetMode = 'HighQuality'
$g.ScaleTransform($s, $s)

# sky
$skyRect = New-Object System.Drawing.RectangleF 0, -1, $w, ($h + 2)
$sky = New-Object System.Drawing.Drawing2D.LinearGradientBrush $skyRect, (Color '#000000'), (Color '#000000'), 90.0
$blend = New-Object System.Drawing.Drawing2D.ColorBlend 4
$blend.Colors = @((Color '#191340'), (Color '#3a2874'), (Color '#84489a'), (Color '#c9648f'))
$blend.Positions = @(0.0, 0.42, 0.68, 1.0)
$sky.InterpolationColors = $blend
$g.FillRectangle($sky, $skyRect)

# stars, the same ones every run
$rand = New-Object System.Random 7
$white = Color '#ffffff'
for ($i = 0; $i -lt 80; $i++) {
    $x = $rand.NextDouble() * $w
    $y = $rand.NextDouble() * 205
    $r = 0.3 + $rand.NextDouble() * 0.6
    $alpha = [int](70 + $rand.NextDouble() * 160 * (1 - $y / 260))
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($alpha, $white))
    $g.FillEllipse($brush, [single]($x - $r), [single]($y - $r), [single](2 * $r), [single](2 * $r))
    $brush.Dispose()
}

# moon: a glow, then the icon's moon
$cx = 82; $cy = 112; $radius = 50
$glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$glowRadius = $radius * 1.7
$glowPath.AddEllipse([single]($cx - $glowRadius), [single]($cy - $glowRadius), [single](2 * $glowRadius), [single](2 * $glowRadius))
$glow = New-Object System.Drawing.Drawing2D.PathGradientBrush $glowPath
$glow.CenterColor = Color '#ffd9a8' 110
$glow.SurroundColors = @((Color '#ffd9a8' 0))
$g.FillPath($glow, $glowPath)

$moonPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$moonPath.AddEllipse([single]($cx - $radius), [single]($cy - $radius), [single](2 * $radius), [single](2 * $radius))
$g.SetClip($moonPath)
# where the moon sits in the 512px icon
$iconCx = 246; $iconCy = 198; $iconRadius = 107
$src = New-Object System.Drawing.RectangleF ($iconCx - $iconRadius), ($iconCy - $iconRadius), (2 * $iconRadius), (2 * $iconRadius)
$dst = New-Object System.Drawing.RectangleF ($cx - $radius), ($cy - $radius), (2 * $radius), (2 * $radius)
$g.DrawImage($icon, $dst, $src, [System.Drawing.GraphicsUnit]::Pixel)
$g.ResetClip()

# the small far moon
$far = New-Object System.Drawing.SolidBrush (Color '#d5d8ee')
$g.FillEllipse($far, 133.0, 40.0, 9.0, 9.0)
$farShade = New-Object System.Drawing.SolidBrush (Color '#9aa0c8')
$g.FillEllipse($farShade, 135.2, 42.0, 2.6, 2.6)
$g.FillEllipse($farShade, 138.4, 45.2, 1.8, 1.8)

# hills, back to front
function Hill([string]$hex, [double[]]$ys) {
    $step = ($w + 40) / ($ys.Length - 1)
    $points = for ($i = 0; $i -lt $ys.Length; $i++) {
        New-Object System.Drawing.PointF ([single](-20 + $i * $step)), ([single]$ys[$i])
    }
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddCurve([System.Drawing.PointF[]]$points, 0.5)
    $path.AddLine([single]($w + 20), [single]($h + 10), [single](-20), [single]($h + 10))
    $path.CloseFigure()
    $brush = New-Object System.Drawing.SolidBrush (Color $hex)
    $g.FillPath($brush, $path)
    $brush.Dispose(); $path.Dispose()
}
Hill '#a557a6' @(214, 206, 212, 204, 198, 208)
Hill '#7647b4' @(222, 210, 220, 228, 216, 222)
Hill '#4a2f98' @(236, 240, 228, 234, 244, 232)
Hill '#2a1c66' @(262, 252, 256, 248, 240, 236)
Hill '#130d36' @(296, 290, 280, 266, 258, 254)

$g.Dispose()

$out = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.InterpolationMode = 'HighQualityBicubic'
$g.PixelOffsetMode = 'HighQuality'
$attributes = New-Object System.Drawing.Imaging.ImageAttributes
$attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
$g.DrawImage($big, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), 0, 0, $big.Width, $big.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
$g.Dispose()

$out.Save((Join-Path $PSScriptRoot 'installerSidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
if ($Preview) {
    $out.Save($Preview, [System.Drawing.Imaging.ImageFormat]::Png)
}
