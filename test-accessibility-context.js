#!/usr/bin/env node

const { spawn } = require('child_process');
const { v4: uuid } = require('uuid');

// Test the getAccessibilityContext RPC method
function testAccessibilityContext() {
    console.log('🧪 Testing getAccessibilityContext RPC method...');
    
    const helperPath = './packages/native-helpers/swift-helper/.build/debug/SwiftHelper';
    const proc = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    
    proc.stderr.on('data', (data) => {
        console.log('📝 Helper stderr:', data.toString());
    });
    
    proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        
        for (const line of lines) {
            try {
                const response = JSON.parse(line);
                console.log('📨 Received response:', JSON.stringify(response, null, 2));
                
                if (response.result && response.result.context) {
                    console.log('✅ Success! Accessibility context received:');
                    console.log('🖥️  Application:', response.result.context.application);
                    console.log('🎯 Focused Element:', response.result.context.focusedElement);
                    console.log('📝 Text Selection:', response.result.context.textSelection);
                    console.log('🪟 Window Info:', response.result.context.windowInfo);
                    console.log('🌐 Browser Info:', response.result.context.browserInfo);
                } else if (response.error) {
                    console.log('❌ Error:', response.error);
                } else {
                    console.log('⚠️  No context data received');
                }
            } catch (e) {
                console.log('📄 Raw output:', line);
            }
        }
        
        proc.kill();
    });
    
    proc.on('error', (err) => {
        console.error('❌ Failed to start helper process:', err);
    });
    
    proc.on('close', (code) => {
        console.log(`🏁 Helper process exited with code ${code}`);
    });
    
    // Send test request
    const request = {
        id: uuid(),
        method: 'getAccessibilityContext',
        params: { editableOnly: false }
    };
    
    console.log('📤 Sending request:', JSON.stringify(request));
    proc.stdin.write(JSON.stringify(request) + '\n');
    
    // Test with editableOnly: true after a delay
    setTimeout(() => {
        const request2 = {
            id: uuid(),
            method: 'getAccessibilityContext',
            params: { editableOnly: true }
        };
        
        console.log('📤 Sending second request (editableOnly: true):', JSON.stringify(request2));
        proc.stdin.write(JSON.stringify(request2) + '\n');
    }, 2000);
}

// Run the test
setTimeout(() => {
    testAccessibilityContext(); 
}, 2000);