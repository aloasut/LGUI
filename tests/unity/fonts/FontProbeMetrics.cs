using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using UnityEngine;
using UnityEngine.Scripting;
using FairyGUI;
using TMPro;

namespace LGUI.Tests
{
    // Development-only readings for tests/unity/fonts/probe.ts. Not part of the LGUI package.
    // Everything here reads what FairyGUI actually laid out and meshed; nothing asks TMP for glyphs on its own
    // (a helper query could add a glyph to the atlas through another path and hide a broken default path).
    [Preserve]
    public static class FontProbeMetrics
    {
        static readonly FieldInfo TextFieldFont = typeof(TextField).GetField("_font", BindingFlags.NonPublic | BindingFlags.Instance);

        /// <summary>Type and name of the font FairyGUI registered under this name, e.g. "ProjectTMPFont:Noto".</summary>
        [Preserve]
        public static string RegisteredFont(string name)
        {
            BaseFont font = FontManager.GetFont(name);
            return font == null ? "" : font.GetType().Name + ":" + font.name;
        }

        /// <summary>Type and name of the font this text field actually draws with (after layout).</summary>
        [Preserve]
        public static string DrawnWith(GTextField field)
        {
            var text = (TextField)field.displayObject;
            text.EnsureSizeCorrect();
            var font = (BaseFont)TextFieldFont.GetValue(text);
            return font == null ? "" : font.GetType().Name + ":" + font.name;
        }

        /// <summary>Atlas population mode, multi-atlas flag and atlas texture count of the project font, e.g. "Dynamic,True,1".</summary>
        [Preserve]
        public static string Atlas(string fontName)
        {
            var font = FontManager.GetFont(fontName) as TMPFont;
            if (font == null) return "";
            return font.fontAsset.atlasPopulationMode + "," + font.fontAsset.isMultiAtlasTexturesEnabled + "," + font.fontAsset.atlasTextures.Length;
        }

        /// <summary>
        /// Sets the text (bold or not) on this field, then lays it out and builds its mesh the way a frame does (TextField.Redraw),
        /// through the field's own font and the default FairyGUI path. Returns "width,vertices,milliseconds,fonts": the laid-out
        /// text width, the vertex count of the text mesh plus its TMP sub-meshes (4 per drawn glyph), the time taken (glyphs not yet
        /// in the atlas are rendered here), and the TMP font assets whose atlases those vertices use, joined by "+".
        /// </summary>
        [Preserve]
        public static string Draw(GTextField field, string value, bool bold)
        {
            var text = (TextField)field.displayObject;
            var watch = Stopwatch.StartNew();
            TextFormat format = field.textFormat;
            format.bold = bold;
            field.textFormat = format;
            field.text = value;
            text.Redraw();
            double ms = watch.Elapsed.TotalMilliseconds;

            var font = TextFieldFont.GetValue(text) as TMPFont;
            int vertices = 0;
            var fonts = new List<string>();
            Count(text.graphics, font, ref vertices, fonts);
            if (text.graphics.subInstances != null)
                foreach (NGraphics sub in text.graphics.subInstances)
                    if (sub.enabled) Count(sub, font, ref vertices, fonts);
            return string.Format(CultureInfo.InvariantCulture, "{0},{1},{2},{3}", text.textWidth, vertices, ms, string.Join("+", fonts));
        }

        static void Count(NGraphics graphics, TMPFont font, ref int vertices, List<string> fonts)
        {
            int count = graphics.mesh == null ? 0 : graphics.mesh.vertexCount;
            if (count == 0) return;
            vertices += count;
            string owner = graphics.texture == null ? "?" : AtlasOwner(font, graphics.texture.nativeTexture);
            if (!fonts.Contains(owner)) fonts.Add(owner);
        }

        // Name of the TMP font asset (the project font or one of its fallbacks) that owns this atlas texture; "?" if none.
        static string AtlasOwner(TMPFont font, Texture texture)
        {
            if (font == null || font.fontAsset == null) return "?";
            if (Array.IndexOf(font.fontAsset.atlasTextures, texture) >= 0) return font.fontAsset.name;
            if (font.fontAsset.fallbackFontAssetTable != null)
                foreach (TMP_FontAsset fallback in font.fontAsset.fallbackFontAssetTable)
                    if (fallback != null && Array.IndexOf(fallback.atlasTextures, texture) >= 0) return fallback.name;
            return "?";
        }
    }
}
