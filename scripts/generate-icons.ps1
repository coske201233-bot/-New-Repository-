Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\coske\.gemini\antigravity\scratch\mobile-app-project\assets\icon.png"
$publicDir = "C:\Users\coske\.gemini\antigravity\scratch\mobile-app-project\public"
$assetsDir = "C:\Users\coske\.gemini\antigravity\scratch\mobile-app-project\assets"

if (!(Test-Path $publicDir)) {
    New-Item -ItemType Directory -Path $publicDir | Out-Null
}

$srcImage = [System.Drawing.Image]::FromFile($srcPath)

function Resize-Image($source, $targetPath, $width, $height) {
    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $graph = [System.Drawing.Graphics]::FromImage($bmp)
    $graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graph.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graph.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graph.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    $graph.DrawImage($source, 0, 0, $width, $height)
    $graph.Dispose()
    
    $bmp.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "Generated: $targetPath ($($width)x$($height))"
}

# 1. public/apple-touch-icon.png (180x180)
Resize-Image $srcImage "$publicDir\apple-touch-icon.png" 180 180
Resize-Image $srcImage "$publicDir\apple-touch-icon-precomposed.png" 180 180

# 2. public/icon-192.png (192x192)
Resize-Image $srcImage "$publicDir\icon-192.png" 192 192

# 3. public/icon-512.png (512x512)
Resize-Image $srcImage "$publicDir\icon-512.png" 512 512

# 4. public/icon.png (512x512)
Resize-Image $srcImage "$publicDir\icon.png" 512 512

# 5. public/favicon.png (48x48 & 32x32)
Resize-Image $srcImage "$publicDir\favicon.png" 48 48
Resize-Image $srcImage "$assetsDir\favicon.png" 48 48

# 6. Copy / Resize for favicon.ico
Resize-Image $srcImage "$publicDir\favicon.ico" 48 48

$srcImage.Dispose()
Write-Output "All icons generated successfully!"
