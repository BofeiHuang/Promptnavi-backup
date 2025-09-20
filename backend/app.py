from flask import Flask, request, jsonify, render_template, make_response
from flask_cors import CORS
from openai import OpenAI
import os
from dotenv import load_dotenv
from ai_service import AIService
import logging
from datetime import datetime
from werkzeug.middleware.proxy_fix import ProxyFix
from typing import Dict, Any, Optional
import requests
import base64
import json

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()

app = Flask(__name__,
    template_folder='templates',
    static_folder='../frontend',
    static_url_path='/frontend'
)

app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
CORS(app)

api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    raise ValueError("No OpenAI API key found. Please set OPENAI_API_KEY environment variable.")

client = OpenAI(api_key=api_key)
ai_service = AIService(client)

@app.errorhandler(400)
def bad_request(error):
    return jsonify({
        'success': False,
        'error': 'Bad Request',
        'message': str(error)
    }), 400

@app.errorhandler(404)
def not_found(error):
    return jsonify({
        'success': False,
        'error': 'Not Found',
        'message': 'The requested resource was not found'
    }), 404

@app.errorhandler(500)
def internal_server_error(error):
    logger.error(f"Internal Server Error: {str(error)}")
    return jsonify({
        'success': False,
        'error': 'Internal Server Error',
        'message': 'An unexpected error occurred'
    }), 500

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/analyze', methods=['POST'])
def analyze():
    try:

        data = request.get_json()
        if not data:
            logger.warning("No data provided in request")
            return jsonify({
                'success': False,
                'error': 'No data provided'
            }), 400


        prompt = data.get('prompt')
        if not prompt:
            logger.warning("No prompt provided in request")
            return jsonify({
                'success': False,
                'error': 'No prompt provided'
            }), 400


        logger.info(f"Analyzing prompt: {prompt}")


        image_data = data.get('image_data')
        image_bytes = None


        if image_data:
            try:
                if isinstance(image_data, str):
                    if image_data.startswith('data:image'):
                        image_data = image_data.split(',')[1]
                    image_bytes = base64.b64decode(image_data)
                else:
                    raise ValueError("Invalid image data format")
            except Exception as e:
                logger.warning(f"Failed to process image data: {e}")
                return jsonify({
                    'success': False,
                    'error': 'Invalid image data format'
                }), 400


        logger.info(f"Calling AI service for analysis")
        result = ai_service.analyze_features(
            prompt=prompt,
            image_data=image_bytes
        )

        logger.info(f"Analysis result: {json.dumps(result, indent=2)}")

        if not result.get('success'):
            error_msg = result.get('error', 'Analysis failed')
            logger.error(f"Analysis failed: {error_msg}")
            raise ValueError(error_msg)


        response = {
            'success': True,
            'analysis': result.get('analysis', {}),
            'message': 'Analysis completed successfully'
        }

        logger.info(f"Sending response: {json.dumps(response, indent=2)}")
        return jsonify(response)

    except Exception as e:
        logger.error(f"Analysis failed: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500



@app.route('/api/interpolate', methods=['POST'])
def interpolate_features():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No data provided'}), 400

        features = data.get('features', {})
        if len(features) < 2:
            return jsonify({'success': False, 'error': 'At least 2 features required'}), 400


        model = data.get('model', 'dall-e-3')
        size = data.get('size', '1024x1024')
        quality = data.get('quality', 'standard')

        logger.info(f"Interpolating features with model: {model}, size: {size}")


        feature_summary = []
        combined_features_str = ""

        for feature_id, feature_data in features.items():
            source_prompt = feature_data.get('sourcePrompt', '')
            weight = feature_data.get('weight', 0.5)
            feature_dict = feature_data.get('features', {})

            if not feature_dict:
                continue

            feature_desc = ", ".join([f"{k} ({v:.0%})" for k, v in feature_dict.items()])
            feature_summary.append(f"{feature_desc} (weight: {weight:.0%})")
            combined_features_str += f"Feature {feature_id}: {feature_desc} with weight {weight:.0%}; "

        logger.info(f"Feature summary: {feature_summary}")


        base_prompt = _compose_interpolation_prompt(combined_features_str)


        refined_prompt = _refine_interpolation_prompt(base_prompt)


        generated_prompt = refined_prompt.strip()
        logger.info(f"Final interpolation prompt: {generated_prompt}")


        result = ai_service.generate_image(
            prompt=generated_prompt,
            model=model,
            size=size,
            quality=quality
        )

        if not result.get('success'):
            logger.error(f"Generation failed: {result.get('error')}")
            return jsonify(result), 500


        analysis_result = ai_service.analyze_features(prompt=generated_prompt)


        response_data = {
            'success': True,
            'url': result['url'],
            'prompt': generated_prompt,
            'analysis': analysis_result.get('analysis', {}),
            'feature_summary': feature_summary,
            'metadata': {
                'model': model,
                'size': size,
                'quality': quality
            }
        }
        return jsonify(response_data)

    except Exception as e:
        logger.error(f"General error: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': f"Server error: {str(e)}"
        }), 500


def _compose_interpolation_prompt(features_str: str) -> str:
    """
    第一步 GPT：把feature信息融合成一个初步、合理的图像描述Prompt
    """
    system_prompt = f"""
    You are an assistant that combines multiple visual features into a cohesive image prompt.

    Features: {features_str}

    Requirements:
    1. Return a single concise sentence or short paragraph describing an image that blends all these features.
    2. Avoid any phrases like "Generating...", "Sure, here it is", etc.
    3. Only return the prompt itself (no JSON needed here).
    """

    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Compose the image prompt from these features."}
        ],
        temperature=0.7,
        max_tokens=200
    )

    return completion.choices[0].message.content.strip()


def _refine_interpolation_prompt(base_prompt: str) -> str:
    """
    第二步 GPT：对初步Prompt做一次语言润色/扩展，让它更吸引人或更详细
    但仍然避免输出无关多余话。
    """
    system_prompt = f"""
    Refine the following image prompt to be more descriptive, artistic, and vivid,
    but still concise. Return only the refined prompt text, nothing else.

    Original prompt: {base_prompt}
    """

    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Please refine the prompt with synonyms or added flair."}
        ],
        temperature=0.7,
        max_tokens=200
    )

    return completion.choices[0].message.content.strip()


@app.route('/api/generate', methods=['POST'])
def generate_image():
    try:
        data = request.get_json()
        if not data or 'prompt' not in data:
            return jsonify({
                'success': False,
                'error': 'No prompt provided'
            }), 400

        model = data.get('model', 'dall-e-2')
        size = data.get('size', '512x512')
        quality = data.get('quality', 'standard')
        base_prompt = data['prompt']


        final_prompt = _refine_generation_prompt(base_prompt)

        logger.info(f"Generating image with prompt: {final_prompt}")

        result = ai_service.generate_image(
            prompt=final_prompt,
            model=model,
            size=size,
            quality=quality
        )

        if not result.get('success'):
            logger.error(f"Generation failed: {result.get('error')}")
            return jsonify(result), 500


        analysis_result = ai_service.analyze_features(final_prompt)
        result['analysis'] = analysis_result.get('analysis', {})

        return jsonify(result)

    except Exception as e:
        logger.error(f"Generation failed: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def _refine_generation_prompt(user_prompt: str) -> str:
    """
    使用GPT对用户传来的prompt做一次语言润色或更多“人性化”调整。
    """
    system_prompt = f"""
    Refine the user's prompt to be more descriptive and vivid for an image generation system.
    Avoid extra text like 'Generating...' or disclaimers.
    Return only the refined prompt text itself.

    Original prompt: {user_prompt}
    """

    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Please refine the prompt with synonyms or added flair."}
        ],
        temperature=0.7,
        max_tokens=200
    )

    return completion.choices[0].message.content.strip()



@app.route('/api/proxy-image', methods=['POST'])
def proxy_image():
    try:
        data = request.get_json()
        image_url = data.get('url')

        if not image_url or not image_url.startswith(('http://', 'https://')):
            return jsonify({'success': False, 'error': 'Invalid or missing URL.'}), 400


        response = requests.get(image_url, timeout=10)
        if response.status_code != 200 or 'image' not in response.headers.get('Content-Type', ''):
            return jsonify({'success': False, 'error': 'Failed to fetch a valid image.'}), response.status_code


        import base64
        image_base64 = base64.b64encode(response.content).decode('utf-8')
        return jsonify({
            'success': True,
            'data': f'data:image/png;base64,{image_base64}'
        })

    except requests.exceptions.RequestException as e:
        logger.error(f"Image fetch error: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to fetch image.'}), 500
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/features/available', methods=['GET'])
def get_available_features():
    """Get list of available feature types and their descriptions"""
    try:
        features = ai_service.get_feature_types()
        return jsonify({
            'success': True,
            'features': features
        })
    except Exception as e:
        logger.error(f"Error getting feature types: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/health')
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'version': '2.0.0'
    })



@app.errorhandler(Exception)
def handle_exception(e):
    logger.error(f"Unhandled exception: {str(e)}", exc_info=True)
    return jsonify({
        'success': False,
        'error': 'Internal server error',
        'message': str(e)
    }), 500

@app.before_request
def before_request():

    if request.method == 'OPTIONS':
        response = make_response()
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type')
        response.headers.add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        return response

if __name__ == '__main__':
    print("\n=== Server Information ===")
    print(f"Template folder: {app.template_folder}")
    print(f"Static folder: {app.static_folder}")
    print(f"Static URL path: {app.static_url_path}")
    if api_key:
        print("OpenAI API key loaded successfully")
    else:
        print("Warning: OpenAI API key not found!")
    print("Server running at: http://localhost:5000")
    print("=========================\n")

    app.run(debug=True, port=5000)