import os
import json
import time
import config_loader

def test_config_loader():
    print("Testing config loader...")
    
    # 1. Test basic loading
    fast_path = config_loader.get_agent_fast_path_keywords()
    assert "run_healthcheck" in fast_path, "Expected run_healthcheck in fast path keywords"
    assert "flow" in fast_path.get("run_automation", []), "Expected 'flow' in run_automation keywords"
    print("✓ Basic keyword loading verification passed.")
    
    prompts = config_loader.get_agent_prompts()
    assert "intent_router" in prompts, "Expected intent_router in agent prompts"
    print("✓ Basic prompt loading verification passed.")
    
    system_prompt = config_loader.get_app_intent_classifier_system_prompt()
    assert "intent classifier" in system_prompt.lower(), "Expected intent classifier in system prompt"
    print("✓ System prompt verification passed.")
    
    # 2. Test modify-reload behavior
    original_mtime = os.path.getmtime(config_loader.CONFIG_FILE_PATH)
    
    # Read original file contents
    with open(config_loader.CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
        original_data = json.load(f)
        
    try:
        # Add a temporary test key
        modified_data = original_data.copy()
        modified_data["agent_fast_path_keywords"]["run_automation"].append("flow_temp_test")
        
        with open(config_loader.CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(modified_data, f, indent=2)
            
        # Force mtime update if it happens too quickly
        os.utime(config_loader.CONFIG_FILE_PATH, (time.time() + 2, time.time() + 2))
        
        # Load again and verify reloading picked it up
        new_fast_path = config_loader.get_agent_fast_path_keywords()
        assert "flow_temp_test" in new_fast_path.get("run_automation", []), "Dynamic reload failed: 'flow_temp_test' not found"
        print("✓ Dynamic modify-reload verification passed!")
        
    finally:
        # Restore original contents
        with open(config_loader.CONFIG_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(original_data, f, indent=2)
        os.utime(config_loader.CONFIG_FILE_PATH, (original_mtime, original_mtime))
        print("✓ Configuration file restored.")

if __name__ == "__main__":
    test_config_loader()
