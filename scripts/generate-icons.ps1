Add-Type -AssemblyName System.Drawing

$sizes = @(72, 96, 128, 144, 152, 180, 192, 384, 512)
$publicDir = Join-Path $PSScriptRoot '..\public'

foreach ($size in $sizes) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(24, 24, 27))

  $margin = [int]($size * 0.18)
  $bubble = [System.Drawing.RectangleF]::new($margin, $margin, $size - (2 * $margin), $size * 0.55)
  $bubbleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(244, 99, 82))
  $graphics.FillEllipse($bubbleBrush, $bubble)

  $tail = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($size * 0.34, $size * 0.66),
    [System.Drawing.PointF]::new($size * 0.28, $size * 0.82),
    [System.Drawing.PointF]::new($size * 0.49, $size * 0.69)
  )
  $graphics.FillPolygon($bubbleBrush, $tail)

  $font = [System.Drawing.Font]::new('Arial', $size * 0.30, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $graphics.DrawString('C', $font, $textBrush, $bubble, $format)

  $dotBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(39, 201, 181))
  $dotSize = $size * 0.10
  $graphics.FillEllipse($dotBrush, $size * 0.69, $size * 0.69, $dotSize, $dotSize)

  $fileName = if ($size -eq 180) { 'apple-touch-icon.png' } else { "icon-$size.png" }
  $bitmap.Save((Join-Path $publicDir $fileName), [System.Drawing.Imaging.ImageFormat]::Png)

  $dotBrush.Dispose()
  $format.Dispose()
  $textBrush.Dispose()
  $font.Dispose()
  $bubbleBrush.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
