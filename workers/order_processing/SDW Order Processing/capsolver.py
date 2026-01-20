import requests
import time
import json
from typing import Dict, Optional
import logging

logger = logging.getLogger(__name__)

class Capsolver:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.api_endpoint = 'https://api.capsolver.com'
        
    def _create_task(self, task_data: Dict) -> str:
        """Create a task and return the task ID"""
        payload = {
            "clientKey": self.api_key,
            "task": task_data
        }
        
        try:
            response = requests.post(
                f"{self.api_endpoint}/createTask",
                json=payload,
                timeout=30
            )
            response.raise_for_status()
            result = response.json()
            
            if result.get("errorId", 0) != 0:
                raise Exception(f"Capsolver error: {result.get('errorDescription', 'Unknown error')}")
                
            task_id = result.get("taskId")
            if not task_id:
                raise Exception("No task ID received from Capsolver")
                
            logger.info(f"Created Capsolver task: {task_id}")
            return task_id
            
        except Exception as e:
            logger.error(f"Error creating Capsolver task: {e}")
            raise
    
    def _get_task_result(self, task_id: str, max_wait: int = 300) -> Dict:
        """Poll for task result"""
        start_time = time.time()
        
        while time.time() - start_time < max_wait:
            try:
                response = requests.post(
                    f"{self.api_endpoint}/getTaskResult",
                    json={
                        "clientKey": self.api_key,
                        "taskId": task_id
                    },
                    timeout=30
                )
                response.raise_for_status()
                result = response.json()
                
                if result.get("errorId", 0) != 0:
                    raise Exception(f"Capsolver error: {result.get('errorDescription', 'Unknown error')}")
                
                status = result.get("status")
                
                if status == "ready":
                    return result.get("solution", {})
                elif status == "failed":
                    raise Exception("Task failed")
                    
                # Still processing, wait before next poll
                time.sleep(3)
                
            except Exception as e:
                logger.error(f"Error polling task result: {e}")
                raise
                
        raise Exception(f"Timeout waiting for task {task_id}")
    
    def solve_aws_waf(self, params: Dict) -> str:
        """Solve AWS WAF challenge"""
        task_data = {
            "type": "AntiAwsWafTaskProxyLess",
            "websiteURL": params['websiteURL'],
            "awsKey": params['awsKey'],
            "awsIv": params['awsIv'],
            "awsContext": params['awsContext'],
            "awsChallengeJS": params.get('awsChallengeJS', params.get('challengeUrl'))
        }
        
        task_id = self._create_task(task_data)
        solution = self._get_task_result(task_id)
        
        if not solution.get("cookie"):
            raise Exception("No cookie in AWS WAF solution")
            
        return solution["cookie"]
    
    def solve_image_captcha(self, params: Dict) -> str:
        """Solve image-based captcha (like Amazon CAPTCHA)"""
        # First, we need to download the image and convert to base64
        image_url = params.get('imageUrl')
        if not image_url:
            raise ValueError("No image URL provided")
            
        # Handle relative URLs
        if image_url.startswith('/'):
            website_url = params.get('websiteURL', '')
            if website_url:
                # Extract domain from website URL
                from urllib.parse import urlparse
                parsed = urlparse(website_url)
                image_url = f"{parsed.scheme}://{parsed.netloc}{image_url}"
        
        # Download image and convert to base64
        try:
            img_response = requests.get(image_url, timeout=30)
            img_response.raise_for_status()
            import base64
            image_base64 = base64.b64encode(img_response.content).decode('utf-8')
        except Exception as e:
            logger.error(f"Error downloading captcha image from {image_url}: {e}")
            raise
        
        task_data = {
            "type": "ImageToTextTask",
            "body": image_base64,
            "module": "amazon",  # Specify Amazon module for Amazon CAPTCHAs
            "score": 0.8,
            "case": True
        }
        
        task_id = self._create_task(task_data)
        solution = self._get_task_result(task_id)
        
        text = solution.get("text")
        if not text:
            raise Exception("No text in image captcha solution")
            
        logger.info(f"Solved image captcha: {text}")
        return text
    
    def solve_recaptcha_v2(self, params: Dict) -> str:
        """Solve reCAPTCHA v2"""
        task_data = {
            "type": "ReCaptchaV2TaskProxyLess",
            "websiteURL": params['websiteURL'],
            "websiteKey": params['websiteKey'],
            "isInvisible": params.get('isInvisible', False)
        }
        
        task_id = self._create_task(task_data)
        solution = self._get_task_result(task_id)
        
        token = solution.get("gRecaptchaResponse")
        if not token:
            raise Exception("No token in reCAPTCHA v2 solution")
            
        return token
    
    def solve_recaptcha_v3(self, params: Dict) -> str:
        """Solve reCAPTCHA v3"""
        task_data = {
            "type": "ReCaptchaV3TaskProxyLess",
            "websiteURL": params['websiteURL'],
            "websiteKey": params['websiteKey'],
            "pageAction": params.get('pageAction', 'submit'),
            "minScore": params.get('minScore', 0.7)
        }
        
        task_id = self._create_task(task_data)
        solution = self._get_task_result(task_id)
        
        token = solution.get("gRecaptchaResponse")
        if not token:
            raise Exception("No token in reCAPTCHA v3 solution")
            
        return token
    
    def solve_hcaptcha(self, params: Dict) -> str:
        """Solve hCaptcha"""
        task_data = {
            "type": "HCaptchaTaskProxyLess",
            "websiteURL": params['websiteURL'],
            "websiteKey": params['websiteKey'],
            "isInvisible": params.get('isInvisible', False),
            "userAgent": params.get('userAgent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        }
        
        task_id = self._create_task(task_data)
        solution = self._get_task_result(task_id)
        
        token = solution.get("gRecaptchaResponse")  # Yes, it's named this way even for hCaptcha
        if not token:
            raise Exception("No token in hCaptcha solution")
            
        return token
    
    def solve_cloudflare_turnstile(self, params: Dict) -> str:
        """Solve Cloudflare Turnstile"""
        task_data = {
            "type": "AntiCloudflareTask",
            "websiteURL": params['websiteURL'],
            "websiteKey": params['websiteKey'],
            "metadata": {
                "type": "turnstile"
            }
        }
        
        task_id = self._create_task(task_data)
        solution = self._get_task_result(task_id)
        
        token = solution.get("token")
        if not token:
            raise Exception("No token in Cloudflare Turnstile solution")
            
        return token
    
    def solve_geetest_v3(self, params: Dict) -> Dict:
        """Solve GeeTest v3"""
        task_data = {
            "type": "GeeTestTaskProxyLess",
            "websiteURL": params['websiteURL'],
            "gt": params['gt'],
            "challenge": params['challenge'],
            "geetestApiServerSubdomain": params.get('apiServer', 'api.geetest.com')
        }
        
        task_id = self._create_task(task_data)
        solution = self._get_task_result(task_id)
        
        return {
            "challenge": solution.get("challenge"),
            "validate": solution.get("validate"),
            "seccode": solution.get("seccode")
        }