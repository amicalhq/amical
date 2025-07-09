using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace WindowsHelper.Models
{
    // These models are platform-specific and intentionally not in the TypeScript schemas
    // They are internal implementation details that get serialized to generic JSON
    // Each platform (Windows/macOS) can structure these differently based on their needs
    
    public class AccessibilityElementNode
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }
        
        [JsonPropertyName("role")]
        public string? Role { get; set; }
        
        [JsonPropertyName("name")]
        public string? Name { get; set; }
        
        [JsonPropertyName("value")]
        public string? Value { get; set; }
        
        [JsonPropertyName("description")]
        public string? Description { get; set; }
        
        [JsonPropertyName("isEditable")]
        public bool IsEditable { get; set; }
        
        [JsonPropertyName("children")]
        public List<AccessibilityElementNode>? Children { get; set; }
    }
    
    // Alias for the generated Context class to match existing code
    public class AccessibilityContext : Context
    {
        // Additional properties that might be missing from generated model
        [JsonPropertyName("applicationName")]
        public string? ApplicationName { get; set; }
        
        [JsonPropertyName("windowTitle")]
        public string? WindowTitle { get; set; }
        
        [JsonPropertyName("focusedElementRole")]
        public string? FocusedElementRole { get; set; }
        
        [JsonPropertyName("isEditable")]
        public bool IsEditable { get; set; }
        
        [JsonPropertyName("isWebContent")]
        public bool IsWebContent { get; set; }
    }
}